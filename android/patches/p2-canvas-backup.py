from pathlib import Path
import re

panel = Path('webapp/src/components/NetPlayPanel.tsx')
s = panel.read_text()

# Keep the legacy canvas/JPEG path alive as a visible fallback even if a peer connection
# reports "connected" before the old Android WebView actually renders its video track.
# The host's game canvas is the source, so no phone UI or notifications are captured.
old = '''        if (!hostRtcConnected && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          const ctx = off.getContext('2d');
'''
new = '''        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          const ctx = off.getContext('2d');
'''
if s.count(old) != 1:
    raise SystemExit(f'Expected one wasm fallback guard, found {s.count(old)}')
s = s.replace(old, new, 1)
old = '''        if (!hostRtcConnected && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          jpgUrl = engine.captureFrameDataUrl(off);
'''
new = '''        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          jpgUrl = engine.captureFrameDataUrl(off);
'''
if s.count(old) != 1:
    raise SystemExit(f'Expected one engine fallback guard, found {s.count(old)}')
s = s.replace(old, new, 1)
# Leave WebRTC sound intact; canvas frames are a visual compatibility/back-up path only.
# Do not hide the JPEG canvas merely because an old WebView reports RTC connected.
old = '''                    guestRtcConnected ? 'w-full h-full object-contain' : 'hidden'
'''
new = '''                    guestVideoReady ? 'w-full h-full object-contain' : 'hidden'
'''
if s.count(old) != 1:
    raise SystemExit('Could not find guest video visibility condition')
s = s.replace(old, new, 1)
old = '''                      !guestRtcConnected
                        ? 'w-full h-full object-contain [image-rendering:pixelated]'
                        : 'hidden'
'''
new = '''                      !guestVideoReady
                        ? 'w-full h-full object-contain [image-rendering:pixelated]'
                        : 'hidden'
'''
if s.count(old) != 1:
    raise SystemExit('Could not find guest canvas visibility condition')
s = s.replace(old, new, 1)
# Mark video usable only after it actually produces a frame (not merely after RTC connects).
old = '''                    muted={p2AudioMuted}
                    className={
'''
new = '''                    muted={p2AudioMuted}
                    onLoadedData={() => setGuestVideoReady(true)}
                    onPlaying={() => setGuestVideoReady(true)}
                    className={
'''
if s.count(old) != 1:
    raise SystemExit('Could not find guest video JSX props')
s = s.replace(old, new, 1)
# Add state next to RTC connection state.
old = '''  const [guestRtcConnected, setGuestRtcConnected] = useState(false);
'''
new = '''  const [guestRtcConnected, setGuestRtcConnected] = useState(false);
  const [guestVideoReady, setGuestVideoReady] = useState(false);
'''
if s.count(old) != 1:
    raise SystemExit('Could not find guest RTC state')
s = s.replace(old, new, 1)
# Reset video-ready flag when receiving a fresh offer and when a connection closes.
old = '''        guestPcRef.current?.close();
        const pc = new RTCPeerConnection({
'''
new = '''        guestPcRef.current?.close();
        setGuestVideoReady(false);
        const pc = new RTCPeerConnection({
'''
if s.count(old) != 1:
    raise SystemExit('Could not find P2 offer setup')
s = s.replace(old, new, 1)
old = '''            setGuestRtcConnected(false);
            guestHasRtcAudioRef.current = false;
'''
new = '''            setGuestRtcConnected(false);
            setGuestVideoReady(false);
            guestHasRtcAudioRef.current = false;
'''
if s.count(old) != 1:
    raise SystemExit('Could not find P2 RTC disconnect handler')
s = s.replace(old, new, 1)

# Keep one small P2 frame decode at a time and refresh at the existing bounded cadence.
# Use the same path in APK and web deployment; don't touch the original source ZIP.
gradle = Path('android/app/build.gradle.kts')
s = gradle.read_text()
s2 = re.sub(r'versionCode = \d+\n\s*versionName = "[^"]+"', 'versionCode = 14\n        versionName = "1.1.3-p2-canvas-fallback"', s, count=1)
if s2 == s or 'versionCode = 14' not in s2:
    raise SystemExit('Could not bump Android APK version')
gradle.write_text(s2)
print('P2 now keeps the game-canvas frame fallback visible until a real video frame arrives; host keeps sending bounded backup frames.')
