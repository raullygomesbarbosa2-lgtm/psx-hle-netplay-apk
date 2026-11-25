from pathlib import Path
import json

# The Android 6 WebView may be too old for JavaScript modules. Build legacy JS/polyfills so
# the React/Firebase sign-in screen can render instead of leaving a blank WebView.
pkg_path = Path('webapp/package.json')
pkg = json.loads(pkg_path.read_text())
pkg.setdefault('devDependencies', {})['@vitejs/plugin-legacy'] = '^8.2.4'
pkg_path.write_text(json.dumps(pkg, ensure_ascii=False, indent=2) + '\n')

vite_path = Path('webapp/vite.config.ts')
s = vite_path.read_text()
if "from '@vitejs/plugin-legacy'" not in s:
    s = s.replace("import react from '@vitejs/plugin-react';", "import react from '@vitejs/plugin-react';\nimport legacy from '@vitejs/plugin-legacy';")
if 'legacy({' not in s:
    s = s.replace('''    plugins: [
      react(),''', '''    plugins: [
      react(),
      legacy({
        targets: ['Chrome >= 44'],
        modernTargets: ['Chrome >= 61'],
        renderLegacyChunks: true,
      }),''')
vite_path.write_text(s)

# Remove only the arbitrary size cutoff for genuine disc images. A ZIP/7z/RAR container is
# not itself a disc image and must be extracted; memory can still limit very large ISO/BINs.
engine_path = Path('webapp/src/emulator/psxWasmEngine.ts')
s = engine_path.read_text()
start = s.find('  const archiveMaxMb = isMobile ? 16 : 64;')
end = s.find('\n}\n', start)
if start < 0 or end < 0:
    raise SystemExit('Could not locate size-limit decision tree')
s = s[:start] + '''  if (isCompressedArchive) {
    return {
      blockedReason: `Esse arquivo é um pacote compactado (${info.serial.replace('-PACK', '')}), não um disco pronto para abrir. Extraia o conteúdo e selecione a imagem do jogo (.BIN/.CUE, .ISO, .IMG, .CHD ou .PBP). O app não recusa discos extraídos por um limite fixo de tamanho; arquivos muito grandes ainda podem exceder a memória disponível do aparelho.`,
      requiresStreamingPrompt: false,
      hardBlockWasm: true,
      sizeMb,
      limitMb: 0,
      hardLimitMb: 0,
      isMobile,
    };
  }

  // Always attempt the actual PS1 core for a valid, uncompressed disc image, regardless of MB size.
  // This removes the old arbitrary 28/48 MB gate; it cannot create extra physical RAM on the phone.
  return {
    blockedReason: null,
    requiresStreamingPrompt: false,
    hardBlockWasm: false,
    sizeMb,
    limitMb: Number.POSITIVE_INFINITY,
    hardLimitMb: Number.POSITIVE_INFINITY,
    isMobile,
  };''' + s[end:]
engine_path.write_text(s)

# Keep an increasing APK version code for updating the user's installed build.
gradle_path = Path('android/app/build.gradle.kts')
gradle = gradle_path.read_text()
import re
gradle = re.sub(r'versionCode = \d+\n\s*versionName = "[^"]+"', 'versionCode = 8\n        versionName = "1.0.7-android6-legacy-large-disc"', gradle, count=1)
if 'versionCode = 8' not in gradle:
    raise SystemExit('Could not set the APK version for the new build')
gradle_path.write_text(gradle)

# Keep instructions user-facing and do not advertise compressed archives as ready-to-play discs.
for file in ['webapp/src/components/SoloEmulatorView.tsx', 'webapp/src/components/GameCatalogView.tsx']:
    p = Path(file)
    text = p.read_text()
    text = text.replace('.iso, .bin, .img, .chd, .pbp, .zip, .7z ou .exe', '.iso, .bin, .img, .chd ou .pbp')
    text = text.replace('.iso, .bin, .img, .chd, .pbp, .zip, .7z, .exe', '.iso, .bin, .img, .chd, .pbp')
    text = text.replace('Suporta .iso, .bin, .img, .chd, .pbp, .zip, .7z e .exe', 'Aceita discos .iso, .bin, .img, .chd e .pbp')
    p.write_text(text)

print('Enabled legacy Android WebView bundles and removed fixed size cutoffs for real disc images.')
