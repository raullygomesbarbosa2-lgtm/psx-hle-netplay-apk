from pathlib import Path
import json

# ZIP support only in Solo: stream archive input in 1 MiB chunks and extract one PS1 disc
# member into Blob-backed parts. The original webapp-source.zip is never edited.
pkg_path = Path('webapp/package.json')
pkg = json.loads(pkg_path.read_text())
pkg.setdefault('dependencies', {})['fflate'] = '^0.8.3'
pkg_path.write_text(json.dumps(pkg, ensure_ascii=False, indent=2) + '\n')

extractor = Path('webapp/src/emulator/zipDiscExtractor.ts')
extractor.write_text(r'''import { AsyncUnzipInflate, Unzip, UnzipPassThrough } from 'fflate';

const INPUT_CHUNK = 1024 * 1024;
const DISC_MEMBER = /\.(iso|bin|img|chd|pbp)$/i;

/** Stream a ZIP file and return its first supported PS1 disc member as a Blob-backed File. */
export async function extractDiscFromZip(archive: File): Promise<File> {
  if (!/^PK/.test(new TextDecoder('ascii').decode(await archive.slice(0, 2).arrayBuffer()))) {
    throw new Error('Esse arquivo não parece ser um ZIP válido.');
  }

  return new Promise<File>(async (resolve, reject) => {
    let chosen = false;
    let settled = false;
    let chosenName = '';
    const parts: Uint8Array[] = [];
    const settleError = (message: string) => {
      if (settled) return;
      settled = true;
      reject(new Error(message));
    };
    const unzip = new Unzip((entry) => {
      if (chosen || entry.name.endsWith('/') || !DISC_MEMBER.test(entry.name)) return;
      chosen = true;
      chosenName = entry.name.split(/[\\/]/).pop() || 'disc.iso';
      entry.ondata = (error, data, final) => {
        if (error) {
          settleError(`Não consegui extrair ${chosenName} do ZIP: ${error.message || error}.`);
          return;
        }
        if (data.length) parts.push(data);
        if (final && !settled) {
          settled = true;
          resolve(new File([new Blob(parts, { type: 'application/octet-stream' })], chosenName, {
            type: 'application/octet-stream',
          }));
        }
      };
      try {
        entry.start();
      } catch (error) {
        settleError(`Este ZIP usa uma compressão que o app não consegue abrir: ${error instanceof Error ? error.message : String(error)}.`);
      }
    });
    unzip.register(AsyncUnzipInflate);
    unzip.register(UnzipPassThrough);
    try {
      for (let offset = 0; offset < archive.size && !settled; offset += INPUT_CHUNK) {
        const end = Math.min(archive.size, offset + INPUT_CHUNK);
        const bytes = new Uint8Array(await archive.slice(offset, end).arrayBuffer());
        unzip.push(bytes, end === archive.size);
      }
      if (!chosen && !settled) {
        settleError('O ZIP abriu, mas não encontrei dentro dele um disco .ISO, .BIN, .IMG, .CHD ou .PBP.');
      }
    } catch (error) {
      settleError(`Erro ao ler o ZIP: ${error instanceof Error ? error.message : String(error)}.`);
    }
  });
}
''')

solo_path = Path('webapp/src/components/SoloEmulatorView.tsx')
s = solo_path.read_text()
needle = "import { StreamingIsoReader } from '../emulator/streamingIsoReader';\n"
if needle not in s:
    raise SystemExit('Could not locate Solo streaming reader import')
s = s.replace(needle, needle + "import { extractDiscFromZip } from '../emulator/zipDiscExtractor';\n", 1)
start = s.find('  const bootSelectedFile = async (file: File) => {')
end = s.find('  const pickBestDiscFile = (files: File[]): File => {', start)
if start < 0 or end < 0:
    raise SystemExit('Could not locate Solo bootSelectedFile')
block = s[start:end]
insert = '''    let selectedFile = file;
    if (/\\.zip$/i.test(file.name)) {
      try {
        selectedFile = await extractDiscFromZip(file);
        pushLog(`[ZIP] Disco extraído: ${selectedFile.name} · ${(selectedFile.size / (1024 * 1024)).toFixed(1)} MB.`);
      } catch (err) {
        setIsoError(err instanceof Error ? err.message : 'Não consegui abrir o ZIP selecionado.');
        setIsoLoading(false);
        setBootPhase('done');
        return;
      }
    }
'''
# Put unzip step after reset/loading state is applied, before cue/image validation.
needle2 = '''    setHleLogs([`[ISO] Analisando arquivo: ${file.name}...`]);

'''
if block.count(needle2) != 1:
    raise SystemExit('Could not locate Solo loading-state point')
block = block.replace(needle2, needle2 + insert + '\n', 1)
block = block.replace('if (/\\.cue$/i.test(file.name) && file.size < 65536)', 'if (/\\.cue$/i.test(selectedFile.name) && selectedFile.size < 65536)')
block = block.replace('`Você selecionou apenas o índice "${file.name}".', '`Você selecionou apenas o índice "${selectedFile.name}".')
block = block.replace('new StreamingIsoReader(file)', 'new StreamingIsoReader(selectedFile)')
block = block.replace('lastFileRef.current = file;', 'lastFileRef.current = selectedFile;')
block = block.replace('launchStreamingMode(file, info)', 'launchStreamingMode(selectedFile, info)')
block = block.replace('launchWasmMode(file, info)', 'launchWasmMode(selectedFile, info)')
block = block.replace('setOomPrompt({ file, info, safety })', 'setOomPrompt({ file: selectedFile, info, safety })')
# The archive itself is accepted only in Solo; other formats and code paths stay unchanged.
s = s[:start] + block + s[end:]
s = s.replace('accept=".iso,.bin,.cue,.img,.chd,.pbp,.mdf,.exe,.psx"', 'accept=".iso,.bin,.cue,.img,.chd,.pbp,.mdf,.zip,.exe,.psx"')
s = s.replace('.iso, .bin, .img, .chd ou .pbp', '.iso, .bin, .img, .chd, .pbp ou .zip')
solo_path.write_text(s)

# Do not re-enable an arbitrary file-size cutoff: leave the existing dynamic Android RAM safety
# check intact. That check protects a low-memory handset from being killed by WebView/WASM.
gradle_path = Path('android/app/build.gradle.kts')
gradle = gradle_path.read_text()
import re
gradle = re.sub(r'versionCode = \d+\n\s*versionName = "[^"]+"', 'versionCode = 10\n        versionName = "1.0.9-solo-zip-disc"', gradle, count=1)
if 'versionCode = 10' not in gradle:
    raise SystemExit('Could not bump APK versionCode')
gradle_path.write_text(gradle)

print('Added streaming ZIP member extraction to Solo only and bumped APK version.')
