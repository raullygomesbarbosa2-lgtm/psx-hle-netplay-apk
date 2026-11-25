from pathlib import Path
import re

panel = Path('webapp/src/components/NetPlayPanel.tsx')
s = panel.read_text()

# Keep the game's JPEG/canvas fallback flowing while approved. Older WebViews can report
# the peer connection as connected before actually rendering its video track.
replacements = [
    ("if (!hostRtcConnected && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {\n          const ctx = off.getContext('2d');",
     "if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {\n          const ctx = off.getContext('2d');"),
    ("if (!hostRtcConnected && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {\n          jpgUrl = engine.captureFrameDataUrl(off);",
     "if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {\n          jpgUrl = engine.captureFrameDataUrl(off);"),
    ("guestRtcConnected ? 'w-full h-full object-contain' : 'hidden'",
     "guestVideoReady ? 'w-full h-full object-contain' : 'hidden'"),
    ("!guestRtcConnected\n                        ? 'w-full h-full object-contain [image-rendering:pixelated]'\n                        : 'hidden'",
     "!guestVideoReady\n                        ? 'w-full h-full object-contain [image-rendering:pixelated]'\n                        : 'hidden'"),
    ("                    muted={p2AudioMuted}\n                    className={\n",
     "                    muted={p2AudioMuted}\n                    onLoadedData={() => setGuestVideoReady(true)}\n                    onPlaying={() => setGuestVideoReady(true)}\n                    className={\n"),
    ("  const [guestRtcConnected, setGuestRtcConnected] = useState(false);\n",
     "  const [guestRtcConnected, setGuestRtcConnected] = useState(false);\n  const [guestVideoReady, setGuestVideoReady] = useState(false);\n"),
    ("        guestPcRef.current?.close();\n        const pc = new RTCPeerConnection({\n",
     "        guestPcRef.current?.close();\n        setGuestVideoReady(false);\n        const pc = new RTCPeerConnection({\n"),
    ("            setGuestRtcConnected(false);\n            guestHasRtcAudioRef.current = false;\n",
     "            setGuestRtcConnected(false);\n            setGuestVideoReady(false);\n            guestHasRtcAudioRef.current = false;\n"),
]
for old, new in replacements:
    if s.count(old) != 1:
        raise SystemExit(f'Expected exactly one patch target, found {s.count(old)}: {old[:110]!r}')
    s = s.replace(old, new, 1)
if s.count('guestVideoReady') != 3:
    raise SystemExit(f'P2 video-ready checks incomplete: {s.count("guestVideoReady")} occurrences')
if 'if (!hostRtcConnected && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {\n          const ctx = off.getContext' in s:
    raise SystemExit('Fallback is still gated on WebRTC state')
panel.write_text(s)

gradle = Path('android/app/build.gradle.kts')
g = gradle.read_text()
g2 = re.sub(r'versionCode = \d+\n\s*versionName = "[^"]+"', 'versionCode = 15\n        versionName = "1.1.4-p2-video-fallback"', g, count=1)
if g2 == g or 'versionCode = 15' not in g2:
    raise SystemExit('Could not bump APK version')
gradle.write_text(g2)
print('Verified P2: canvas stays visible until real video playback; host sends frames even after RTC reports connected.')
