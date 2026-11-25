from pathlib import Path
import re

panel = Path('webapp/src/components/NetPlayPanel.tsx')
s = panel.read_text()
needle = '''  const [audioOn, setAudioOn] = useState(true);
  const privacyEnabled = useRemotePrivacyEnabled();
'''
replacement = '''  const [audioOn, setAudioOn] = useState(true); // Local P1 game audio only
  const [remoteAudioOn, setRemoteAudioOn] = useState(true); // P1 -> P2 transport only
  const remoteAudioOnRef = useRef(true);
  const remoteAudioSenderRef = useRef<RTCRtpSender | null>(null);
  const privacyEnabled = useRemotePrivacyEnabled();
'''
if s.count(needle) != 1: raise SystemExit('NetPlay audio state insertion point not found')
s = s.replace(needle, replacement, 1)
needle = '''  useEffect(() => {
    p2AudioMutedRef.current = p2AudioMuted;
  }, [p2AudioMuted]);
'''
replacement = needle + '''
  useEffect(() => {
    remoteAudioOnRef.current = remoteAudioOn;
    const track = remoteAudioSenderRef.current?.track;
    if (track) track.enabled = remoteAudioOn;
  }, [remoteAudioOn]);
'''
if s.count(needle) != 1: raise SystemExit('Remote audio state synchronization point not found')
s = s.replace(needle, replacement, 1)
needle = '''    let audioSender: RTCRtpSender | null =
      pc.getSenders().find((s) => s.track?.kind === 'audio') ?? null;
'''
replacement = needle + '''    remoteAudioSenderRef.current = audioSender;
    if (audioSender?.track) audioSender.track.enabled = remoteAudioOnRef.current;
'''
if s.count(needle) != 1: raise SystemExit('Initial WebRTC audio sender block not found')
s = s.replace(needle, replacement, 1)
needle = '''      if (audioSender) {
        void audioSender.replaceTrack(newTrack).catch(() => {});
      } else {
        try {
          outgoingStream.addTrack(newTrack);
          audioSender = pc.addTrack(newTrack, outgoingStream);
          void sendOffer();
'''
replacement = '''      newTrack.enabled = remoteAudioOnRef.current;
      if (audioSender) {
        void audioSender.replaceTrack(newTrack).catch(() => {});
      } else {
        try {
          outgoingStream.addTrack(newTrack);
          audioSender = pc.addTrack(newTrack, outgoingStream);
          audioSender.track.enabled = remoteAudioOnRef.current;
          remoteAudioSenderRef.current = audioSender;
          void sendOffer();
'''
if s.count(needle) != 1: raise SystemExit('Dynamic WebRTC audio sender block not found')
s = s.replace(needle, replacement, 1)
needle = '''      if (hostPcRef.current === pc) {
        hostPcRef.current = null;
      }
'''
replacement = needle + '''      if (remoteAudioSenderRef.current === audioSender) remoteAudioSenderRef.current = null;
'''
if s.count(needle) != 1: raise SystemExit('WebRTC sender cleanup point not found')
s = s.replace(needle, replacement, 1)
needle = '''    const unsubPcm = subscribeHostPcmAudio((chunk) => {
      if (hostRtcConnected) return;
'''
replacement = '''    const unsubPcm = subscribeHostPcmAudio((chunk) => {
      if (!remoteAudioOnRef.current) return;
      if (hostRtcConnected) return;
'''
if s.count(needle) != 1: raise SystemExit('PCM audio forwarding gate not found')
s = s.replace(needle, replacement, 1)

old = '''                {isHost ? (
                  <button
                    type="button"
                    onClick={() => {
                      const next = !audioOn;
                      setAudioOn(next);
                      spuRef.current.setEnabled(next);
                      hostEngineRef.current?.setMuted(!next);
                      hostStreamConsoleRef.current?.spu.setEnabled(next);
                    }}
                    className="p-1.5 bg-[#0F1115] border border-[#262B36] rounded-md text-slate-300 hover:text-white"
                    aria-label="Alternar Áudio"
                  >
                    {audioOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                  </button>
                ) : (
'''
new = '''                {isHost ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        const next = !audioOn;
                        setAudioOn(next);
                        spuRef.current.setEnabled(next);
                        hostEngineRef.current?.setMuted(!next);
                        hostStreamConsoleRef.current?.spu.setEnabled(next);
                      }}
                      className="p-1.5 bg-[#0F1115] border border-[#262B36] rounded-md text-slate-300 hover:text-white"
                      aria-label="Alternar áudio local do jogo no P1"
                      title="Áudio local do jogo no P1"
                    >
                      {audioOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => setRemoteAudioOn((enabled) => !enabled)}
                      aria-label="Alternar transmissão do áudio do jogo para o P2"
                      title="Controla somente o áudio enviado ao P2; não muda o som local do P1"
                      className={`inline-flex items-center gap-1 px-2 py-1 border rounded-md text-[10px] whitespace-nowrap shrink-0 ${remoteAudioOn ? 'bg-emerald-950/30 border-emerald-800/70 text-emerald-300' : 'bg-[#0F1115] border-[#262B36] text-slate-300'}`}
                    >
                      {remoteAudioOn ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                      Áudio P2 {remoteAudioOn ? 'ON' : 'OFF'}
                    </button>
                  </>
                ) : (
'''
if s.count(old) != 1: raise SystemExit('Could not split host local and remote audio controls')
s = s.replace(old, new, 1)
panel.write_text(s)

privacy = Path('webapp/src/components/RemotePrivacySettings.tsx')
s = privacy.read_text()
s = s.replace('Ativar proteção automática', 'Privacidade · proteger notificações')
s = s.replace('Aplica Não Perturbe temporário no aparelho durante jogo/sessão. Restaura o modo anterior ao sair.', 'Protege a sessão contra notificações. No APK, usa Não Perturbe em prioridade, permitindo áudio de mídia, e restaura as configurações anteriores ao sair. Não altera o volume, o áudio local do jogo nem o áudio enviado ao P2.')
s = s.replace('A transmissão do P1 é composta somente pela imagem do canvas do jogo e pelo áudio do emulador (WebRTC/PCM); não captura a tela, notificações nem microfone.', 'Privacidade e áudio são independentes: o P1 envia somente a imagem do canvas do jogo e, se Áudio P2 estiver ligado, o áudio do emulador (WebRTC/PCM); não captura tela do sistema, notificações nem microfone. Ativar ou desligar Privacidade não altera o volume do jogo, não silencia o P1 e não suspende o AudioContext.')
s = s.replace('Configurar autorização do Não Perturbe', 'Configurar proteção de notificações do Android')
s = s.replace('O Android pode pedir autorização especial. Ela só é usada temporariamente durante a sessão; o app não desativa notificações permanentemente. Em navegadores sem integração Android, o envio continua restrito ao jogo.', 'No APK, o Android pode pedir autorização especial. A proteção é temporária e restaurada ao encerrar. O modo Prioridade permite áudio de mídia para manter o jogo audível. Em navegador, o P2 continua recebendo apenas o canvas e o áudio do jogo, nunca a tela do sistema.')
privacy.write_text(s)

gradle = Path('android/app/build.gradle.kts')
s = gradle.read_text()
s2 = re.sub(r'versionCode = \d+\n\s*versionName = "[^"]+"', 'versionCode = 18\n        versionName = "1.1.7-audio-privacy-independent"', s, count=1)
if 'versionCode = 18' not in s2: raise SystemExit('Could not bump APK version')
gradle.write_text(s2)
print('Separated P1 local game audio and P1-to-P2 audio forwarding; privacy remains separate.')
