from pathlib import Path
import re

solo_path = Path('webapp/src/components/SoloEmulatorView.tsx')
s = solo_path.read_text()
start = s.find('  const launchStreamingMode = async (file: File, info: IsoMountInfo) => {')
end = s.find('  const bootSelectedFile = async (file: File) => {', start)
if start < 0 or end < 0:
    raise SystemExit('Could not locate Solo streaming fallback')
s = s[:start] + '''  const launchStreamingMode = async (_file: File, info: IsoMountInfo) => {
    // Previous custom fallback drew telemetry, not PS1 gameplay. Never present it as a running game.
    streamConsoleRef.current?.stop();
    streamConsoleRef.current = null;
    engineRef.current?.destroy();
    setActiveBackend('idle');
    setGameStarted(false);
    setBootPhase('done');
    setIsoLoading(false);
    setIsoError(
      info.isDirectExe
        ? 'Esse arquivo é só um executável PS1, não um disco completo. Escolha a imagem completa do jogo (.BIN/.CUE, .ISO, .IMG, .CHD ou .PBP).'
        : 'Não foi possível abrir este arquivo como um disco PS1 no núcleo completo. Arquivos .ZIP/.7Z/.RAR são compactados: extraia o disco antes de selecionar. O modo técnico não é o jogo.',
    );
    pushLog('[HLE] O modo de diagnóstico não será mostrado como se fosse o jogo.');
  };

''' + s[end:]
# Drop the fake streaming action from the memory prompt.
s, n = re.subn(r'\s*<button\s+type="button"\s+onClick=\{\(\) => void launchStreamingMode\(oomPrompt\.file, oomPrompt\.info\)\}[\s\S]*?Modo Seguro Streaming \(&lt; 8 MB RAM\)[\s\S]*?</button>\s*', '\n', s, count=1)
if n != 1:
    raise SystemExit(f'Expected one fake streaming button in RAM prompt, found {n}')
# Plain-language explanation and an exit action instead of the diagnostic backend.
pattern = r'<p className="text-\[11px\] text-slate-400 max-w-md">[\s\S]*?compile o app nativo[\s\S]*?</p>'
s, n = re.subn(pattern, '''<p className="text-[11px] text-slate-400 max-w-md">
                    {oomPrompt.safety.hardBlockWasm
                      ? 'Esse arquivo é grande demais para o núcleo completo neste celular. O modo técnico não mostra o jogo. Escolha um disco menor ou convertido para .CHD/.PBP.'
                      : 'Para ver o jogo de verdade, ele precisa abrir no núcleo PS1 completo; o modo técnico não será usado como substituto.'}
                  </p>
                  <button type="button" onClick={() => { setOomPrompt(null); setMountedIso(null); setActiveBackend('idle'); setGameStarted(false); }} className="rounded-lg border border-[#354052] bg-[#202633] px-4 py-2 text-xs font-medium text-white hover:bg-[#293243]">Voltar e escolher outra imagem</button>''', s, count=1)
if n != 1:
    raise SystemExit(f'Expected RAM prompt guidance, found {n}')
# Remove the old action that launched the same fake overlay from the error panel.
s, n = re.subn(r'\s*\{lastFileRef\.current && \([\s\S]*?Abrir em Modo Streaming Seguro[\s\S]*?</button>\s*\)\}\s*', '\n', s, count=1)
if n != 1:
    raise SystemExit(f'Expected one fake retry action, found {n}')
# Do not advertise archive containers as ready-to-play games.
s = s.replace('Suporta .iso, .bin, .img, .chd, .pbp, .zip, .7z e .exe', 'Selecione o disco extraído .BIN/.CUE, .ISO, .IMG, .CHD ou .PBP')
s = s.replace('.iso, .bin, .img, .chd, .pbp, .zip, .7z ou .exe', '.iso, .bin, .img, .chd ou .pbp')
s = s.replace('accept=".iso,.bin,.cue,.img,.chd,.pbp,.mdf,.zip,.7z,.rar,.exe,.psx"', 'accept=".iso,.bin,.cue,.img,.chd,.pbp,.mdf,.exe,.psx"')
solo_path.write_text(s)

engine_path = Path('webapp/src/emulator/psxWasmEngine.ts')
s = engine_path.read_text()
s = s.replace(
    'Arquivo compactado (${sizeMb.toFixed(1)} MB) em ${info.serial} excede o limite de descompressão na memória do ${isMobile ? \'celular\' : \'navegador\'} (${archiveMaxMb} MB). Extraia para .BIN, .ISO ou .CHD antes de abrir para evitar queda da aba ("Aw, Snap!").',
    'Esse arquivo está compactado (${sizeMb.toFixed(1)} MB), não é o disco pronto para jogar. Extraia o jogo e selecione o arquivo .BIN/.CUE, .ISO, .IMG, .CHD ou .PBP.',
)
s = s.replace('Use o Modo Seguro Streaming ou um arquivo .BIN/.IMG/.CHD menor.', 'Escolha uma imagem de disco menor (.BIN/.IMG/.CHD) ou converta o disco para .CHD.')
engine_path.write_text(s)

net_path = Path('webapp/src/components/NetPlayPanel.tsx')
s = net_path.read_text()
start = s.find('  const launchHostStreaming = async (file: File) => {')
end = s.find('  const handleHostLoadIso = async (e: React.ChangeEvent<HTMLInputElement>) => {', start)
if start < 0 or end < 0:
    raise SystemExit('Could not locate NetPlay streaming fallback')
s = s[:start] + '''  const launchHostStreaming = async (_file: File) => {
    // Do not send the old diagnostic-only HLE placeholder as if it were real gameplay.
    hostStreamConsoleRef.current?.stop();
    hostStreamConsoleRef.current = null;
    hostEngineRef.current?.destroy();
    setHostBackend('idle');
    setHostGameStarted(false);
    setBootPhase('done');
    setIsoLoading(false);
    setStatusError('Esse arquivo não abriu no núcleo PS1 completo. O modo técnico não mostra o jogo. Selecione o disco completo extraído (.BIN/.CUE, .ISO, .IMG, .CHD ou .PBP); não escolha o arquivo .ZIP/.7Z/.RAR nem um executável sozinho.');
    if (roomDoc) {
      await hostUpdateRoom(roomDoc.roomCode, { status: 'waiting' }).catch(() => {});
    }
  };

''' + s[end:]
old = '''      if (info.isDirectExe) {
        await launchHostStreaming(file);
        return;
      }
'''
new = '''      if (info.isDirectExe) {
        await hostUpdateRoom(roomDoc.roomCode, { status: 'waiting' }).catch(() => {});
        await launchHostStreaming(file);
        return;
      }
'''
if s.count(old) != 1:
    raise SystemExit('Could not locate NetPlay direct EXE branch')
s = s.replace(old, new)
# Remove the equivalent fake HLE button from the multiplayer large-image prompt too.
s, n = re.subn(r'\s*<button\s+type="button"\s+onClick=\{\(\) => void launchHostStreaming\(hostOomPrompt\.file\)\}[\s\S]*?Modo Seguro Streaming \(&lt; 8 MB\)[\s\S]*?</button>\s*', '\n', s, count=1)
if n != 1:
    raise SystemExit(f'Expected one multiplayer fake streaming button, found {n}')
old_guidance = '''                      </div>
                    </div>
                  )}
                  {!mountedIso && !hostOomPrompt && (
'''
new_guidance = '''                      </div>
                      <p className="max-w-md text-[11px] text-slate-400">
                        {hostOomPrompt.safety.hardBlockWasm
                          ? 'Esse arquivo é grande demais para o núcleo completo neste celular. O modo técnico não mostra o jogo; use um disco menor ou convertido para .CHD/.PBP.'
                          : 'Para transmitir o jogo real, ele precisa iniciar no núcleo PS1 completo; o modo técnico não será usado como substituto.'}
                      </p>
                      <button type="button" onClick={() => { setHostOomPrompt(null); setMountedIso(null); setHostBackend('idle'); setHostGameStarted(false); }} className="rounded-lg border border-[#354052] bg-[#202633] px-4 py-2 text-xs font-medium text-white hover:bg-[#293243]">Voltar e escolher outro disco</button>
                    </div>
                  )}
                  {!mountedIso && !hostOomPrompt && (
'''
if s.count(old_guidance) != 1:
    raise SystemExit('Could not locate multiplayer RAM prompt closing point')
s = s.replace(old_guidance, new_guidance)
net_path.write_text(s)
print('Removed fake diagnostic-game fallback; tightened archive guidance and preserved the original ZIP source.')
