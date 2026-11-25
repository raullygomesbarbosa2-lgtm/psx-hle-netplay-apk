from pathlib import Path
import re

panel = Path('webapp/src/components/NetPlayPanel.tsx')
s = panel.read_text()

# P2 can decode more slowly than an incoming stream (Chrome 54 / low-RAM Marshmallow).
# Keep only one decode operation and the newest pending JPEG rather than allocating an
# Image per incoming frame and building an unbounded decode queue.
needle = '''  const guestCanvasRef = useRef<HTMLCanvasElement | null>(null);
'''
replacement = '''  const guestCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const guestFrameImageRef = useRef<HTMLImageElement | null>(null);
  const pendingGuestFrameRef = useRef<string | null>(null);
  const decodingGuestFrameRef = useRef(false);
'''
if s.count(needle) != 1:
    raise SystemExit('Could not find guest canvas ref')
s = s.replace(needle, replacement, 1)

old = '''        } else if (msg.type === 'netplay:frame' && role === 'p2') {
          const payload = msg.data as { img?: string } | undefined;
          if (payload?.img && guestCanvasRef.current) {
            const ctx = guestCanvasRef.current.getContext('2d');
            if (!ctx) return;
            const img = new Image();
            img.onload = () => {
              ctx.imageSmoothingEnabled = false;
              ctx.drawImage(img, 0, 0, 320, 240);
            };
            img.src = payload.img;
          }
'''
new = '''        } else if (msg.type === 'netplay:frame' && role === 'p2') {
          const payload = msg.data as { img?: string } | undefined;
          if (payload?.img && guestCanvasRef.current) {
            pendingGuestFrameRef.current = payload.img;
            if (!decodingGuestFrameRef.current) {
              const decodeNextFrame = () => {
                const frame = pendingGuestFrameRef.current;
                const canvas = guestCanvasRef.current;
                if (!frame || !canvas) {
                  decodingGuestFrameRef.current = false;
                  return;
                }
                pendingGuestFrameRef.current = null;
                decodingGuestFrameRef.current = true;
                let img = guestFrameImageRef.current;
                if (!img) {
                  img = new Image();
                  guestFrameImageRef.current = img;
                }
                img.onload = () => {
                  const ctx = canvas.getContext('2d');
                  if (ctx) {
                    ctx.imageSmoothingEnabled = false;
                    ctx.drawImage(img!, 0, 0, 320, 240);
                  }
                  decodingGuestFrameRef.current = false;
                  if (pendingGuestFrameRef.current) decodeNextFrame();
                };
                img.onerror = () => {
                  decodingGuestFrameRef.current = false;
                  if (pendingGuestFrameRef.current) decodeNextFrame();
                };
                img.src = frame;
              };
              decodeNextFrame();
            }
          }
'''
if s.count(old) != 1:
    raise SystemExit('Could not find P2 JPEG frame handler')
s = s.replace(old, new, 1)

# The WebRTC track is also downscaled at P1 before it reaches the P2 decoder.
old = '''    if (srcCanvas && typeof srcCanvas.captureStream === 'function') {
      try {
        const canvasStream = srcCanvas.captureStream(30);
        const vTrack = canvasStream.getVideoTracks()[0];
        if (vTrack) {
          outgoingStream.addTrack(vTrack);
          pc.addTrack(vTrack, outgoingStream);
        }
      } catch {
        // Fallback to WebSocket JPEG frame stream
      }
    }
'''
new = '''    let boundedStreamCanvas: HTMLCanvasElement | null = null;
    let boundedStreamTimer: number | null = null;
    if (srcCanvas && typeof srcCanvas.captureStream === 'function') {
      try {
        boundedStreamCanvas = document.createElement('canvas');
        boundedStreamCanvas.width = 320;
        boundedStreamCanvas.height = 240;
        const boundedContext = boundedStreamCanvas.getContext('2d');
        const copyBoundedFrame = () => {
          if (!srcCanvas || !boundedContext) return;
          boundedContext.imageSmoothingEnabled = false;
          boundedContext.drawImage(srcCanvas, 0, 0, 320, 240);
        };
        copyBoundedFrame();
        // A 10 fps 320x240 track keeps P2 memory and decoder work bounded on older phones.
        boundedStreamTimer = window.setInterval(copyBoundedFrame, 100);
        const canvasStream = boundedStreamCanvas.captureStream(10);
        const vTrack = canvasStream.getVideoTracks()[0];
        if (vTrack) {
          outgoingStream.addTrack(vTrack);
          pc.addTrack(vTrack, outgoingStream);
        }
      } catch {
        if (boundedStreamTimer !== null) window.clearInterval(boundedStreamTimer);
        boundedStreamTimer = null;
        // Fall back to the already downscaled, throttled WebSocket JPEG frames.
      }
    }
'''
if s.count(old) != 1:
    raise SystemExit('Could not find direct canvas capture code')
s = s.replace(old, new, 1)
# Clear timer on effect cleanup alongside peer connection disposal.
old_cleanup = '''      cancelled = true;
      unsubTrack();
      pc.close();
'''
new_cleanup = '''      cancelled = true;
      unsubTrack();
      if (boundedStreamTimer !== null) window.clearInterval(boundedStreamTimer);
      pc.close();
'''
if s.count(old_cleanup) != 1:
    raise SystemExit('Could not find RTC effect cleanup')
s = s.replace(old_cleanup, new_cleanup, 1)
# Reduce fallback rate and JPEG quality for old, low-memory P2 browser.
s = s.replace('jpgUrl = off.toDataURL(\'image/jpeg\', 0.62);', 'jpgUrl = off.toDataURL(\'image/jpeg\', 0.42);')
if s.count('    }, 45);') < 1:
    raise SystemExit('Could not find 45ms relay frame interval')
s = s.replace('    }, 45);', '    }, 120);', 1)
panel.write_text(s)

# Keep both published Chrome 54 web variant and the APK generation using the same targeted patch.
gradle = Path('android/app/build.gradle.kts')
s = gradle.read_text()
s = re.sub(r'versionCode = \d+\n\s*versionName = "[^"]+"', 'versionCode = 13\n        versionName = "1.1.2-bounded-p2-video"', s, count=1)
if 'versionCode = 13' not in s:
    raise SystemExit('Could not bump APK versionCode')
gradle.write_text(s)
print('Bound P2 frame decoding and capped both remote video paths at 320x240 / 10 fps.')
