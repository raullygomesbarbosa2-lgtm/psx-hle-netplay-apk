from pathlib import Path

# Multiplayer: ZIP extraction was wired only into Solo. Use the same streaming extractor
# for the P1's selected game before inspecting/booting it; P2 remains stream-only.
panel = Path('webapp/src/components/NetPlayPanel.tsx')
s = panel.read_text()
needle = "import { StreamingIsoReader } from '../emulator/streamingIsoReader';\n"
if needle not in s: raise SystemExit('NetPlay StreamingIsoReader import not found')
if "import { extractDiscFromZip } from '../emulator/zipDiscExtractor';" not in s:
    s = s.replace(needle, needle + "import { extractDiscFromZip } from '../emulator/zipDiscExtractor';\n", 1)
start = s.find('  const handleHostLoadIso = async (e: React.ChangeEvent<HTMLInputElement>) => {')
end = s.find('  const emitMergedP1Pad = useCallback(() => {', start)
if start < 0 or end < 0: raise SystemExit('Could not locate NetPlay ISO handler')
block = s[start:end]
block = block.replace(
    "    const file = files.find((f) => ACCEPTED_DISC_EXT.test(f.name)) ?? files[0];\n    if (!file || !roomDoc || !isHost) return;",
    "    let file = files.find((f) => ACCEPTED_DISC_EXT.test(f.name)) ?? files[0];\n    if (!file || !roomDoc || !isHost) return;",
    1,
)
needle = '''    setHostFrameNum(0);

    if (/\\.cue$/i.test(file.name) && file.size < 65536) {
'''
replacement = '''    setHostFrameNum(0);

    try {
      if (/\\.zip$/i.test(file.name)) {
        file = await extractDiscFromZip(file);
      }

    if (/\\.cue$/i.test(file.name) && file.size < 65536) {
'''
if block.count(needle) != 1: raise SystemExit('Could not insert ZIP extraction in NetPlay loader')
block = block.replace(needle, replacement, 1)
# The existing try block now begins before cue checks, so close it consistently: remove its
# original nested try and retain its catch/finally around the complete sequence.
block = block.replace('''    try {
      const reader = new StreamingIsoReader(file);
''','''      const reader = new StreamingIsoReader(file);
''',1)
# Existing early returns remain inside the try; JS finally still resets the file input.
s = s[:start] + block + s[end:]
panel.write_text(s)

# Touch controls: capture-phase stopPropagation at the full-screen overlay prevented child
# controls from receiving input. Capture only prevents browser scrolling/zoom gestures.
pad = Path('webapp/src/components/VirtualGamepad.tsx')
s = pad.read_text()
needle = '''function blockAndPrevent(e: React.SyntheticEvent): void {
  e.preventDefault();
  e.stopPropagation();
}
'''
insert = needle + '''
function preventTouchDefault(e: React.SyntheticEvent): void {
  e.preventDefault();
}

function hasPointerEvents(): boolean {
  return typeof window !== 'undefined' && 'PointerEvent' in window;
}

function legacyTouchId(identifier: number): number {
  return -(identifier + 1);
}
'''
if s.count(needle) != 1: raise SystemExit('Control event helper not found')
s = s.replace(needle, insert, 1)
# Sticks support old WebViews without Pointer Events.
s = s.replace('''      onTouchStart={stopSurfaceEvent}
      onTouchMove={stopSurfaceEvent}
      onTouchEnd={stopSurfaceEvent}
      onMouseDown={stopSurfaceEvent}
''','''      onTouchStart={(e) => {
        if (hasPointerEvents()) return;
        e.preventDefault();
        e.stopPropagation();
        if (disabled) return;
        const touch = e.changedTouches[0];
        if (!touch) return;
        onInteract?.();
        pointerIdRef.current = legacyTouchId(touch.identifier);
        updatePos(touch.clientX, touch.clientY);
      }}
      onTouchMove={(e) => {
        if (hasPointerEvents()) return;
        e.preventDefault();
        e.stopPropagation();
        const id = pointerIdRef.current;
        if (id === null || disabled) return;
        const touch = Array.from(e.changedTouches).find((t) => legacyTouchId(t.identifier) === id);
        if (touch) updatePos(touch.clientX, touch.clientY);
      }}
      onTouchEnd={(e) => {
        if (hasPointerEvents()) return;
        e.preventDefault();
        e.stopPropagation();
        const id = pointerIdRef.current;
        if (id !== null && Array.from(e.changedTouches).some((t) => legacyTouchId(t.identifier) === id)) {
          pointerIdRef.current = null;
          onMove(128, 128);
        }
      }}
      onTouchCancel={(e) => {
        if (hasPointerEvents()) return;
        e.preventDefault();
        e.stopPropagation();
        pointerIdRef.current = null;
        onMove(128, 128);
      }}
      onMouseDown={stopSurfaceEvent}
''',1)
# Action / shoulder buttons legacy touch support, preserving independent fingers.
old = '''    onTouchStart: stopSurfaceEvent,
    onTouchMove: stopSurfaceEvent,
    onTouchEnd: stopSurfaceEvent,
'''
new = '''    onTouchStart: (e: React.TouchEvent<HTMLElement>) => {
      if (hasPointerEvents()) return;
      e.preventDefault();
      e.stopPropagation();
      if (disabled) return;
      onUserInteract?.();
      Array.from(e.changedTouches).forEach((touch) => pointerBitsRef.current.set(legacyTouchId(touch.identifier), bit));
      flushState();
    },
    onTouchMove: (e: React.TouchEvent<HTMLElement>) => {
      if (hasPointerEvents()) return;
      e.preventDefault();
      e.stopPropagation();
    },
    onTouchEnd: (e: React.TouchEvent<HTMLElement>) => {
      if (hasPointerEvents()) return;
      e.preventDefault();
      e.stopPropagation();
      Array.from(e.changedTouches).forEach((touch) => pointerBitsRef.current.delete(legacyTouchId(touch.identifier)));
      flushState();
    },
    onTouchCancel: (e: React.TouchEvent<HTMLElement>) => {
      if (hasPointerEvents()) return;
      e.preventDefault();
      e.stopPropagation();
      Array.from(e.changedTouches).forEach((touch) => pointerBitsRef.current.delete(legacyTouchId(touch.identifier)));
      flushState();
    },
'''
if s.count(old) != 1: raise SystemExit('Button touch event block not found')
s = s.replace(old, new, 1)
# D-pad support.
old = '''              onTouchStart={stopSurfaceEvent}
              onTouchMove={stopSurfaceEvent}
              onTouchEnd={stopSurfaceEvent}
              onMouseDown={stopSurfaceEvent}
'''
new = '''              onTouchStart={(e) => {
                if (hasPointerEvents()) return;
                e.preventDefault();
                e.stopPropagation();
                if (disabled) return;
                const touch = e.changedTouches[0];
                if (!touch) return;
                onUserInteract?.();
                dpadPointerIdRef.current = legacyTouchId(touch.identifier);
                dpadMaskRef.current = computeDpadBitsFromPoint(touch.clientX, touch.clientY);
                flushState();
              }}
              onTouchMove={(e) => {
                if (hasPointerEvents()) return;
                e.preventDefault();
                e.stopPropagation();
                const id = dpadPointerIdRef.current;
                if (id === null || disabled) return;
                const touch = Array.from(e.changedTouches).find((t) => legacyTouchId(t.identifier) === id);
                if (touch) {
                  dpadMaskRef.current = computeDpadBitsFromPoint(touch.clientX, touch.clientY);
                  flushState();
                }
              }}
              onTouchEnd={(e) => {
                if (hasPointerEvents()) return;
                e.preventDefault();
                e.stopPropagation();
                const id = dpadPointerIdRef.current;
                if (id !== null && Array.from(e.changedTouches).some((t) => legacyTouchId(t.identifier) === id)) {
                  dpadPointerIdRef.current = null;
                  dpadMaskRef.current = 0;
                  flushState();
                }
              }}
              onTouchCancel={(e) => {
                if (hasPointerEvents()) return;
                e.preventDefault();
                e.stopPropagation();
                dpadPointerIdRef.current = null;
                dpadMaskRef.current = 0;
                flushState();
              }}
              onMouseDown={stopSurfaceEvent}
'''
if s.count(old) != 1: raise SystemExit('D-pad touch block not found')
s = s.replace(old, new, 1)
# The overlay capture must not stop events before the actual controls receive them.
s = s.replace('''      onPointerDownCapture={stopSurfaceEvent}
      onTouchStartCapture={stopSurfaceEvent}
''','''      onPointerDownCapture={preventTouchDefault}
      onTouchStartCapture={preventTouchDefault}
''',1)
pad.write_text(s)

# Mobile viewport: prevent horizontal overflow; let the long lobby scroll vertically, safely
# below Android's system bars. Keep the viewport zoomable and preserve the existing layout.
index = Path('webapp/index.html')
s = index.read_text().replace(
    '<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />',
)
index.write_text(s)
css = Path('webapp/src/index.css')
s = css.read_text()
needle = '''@layer base {
'''
insert = '''html, body, #root {
  width: 100%;
  min-width: 320px;
  min-height: 100%;
  margin: 0;
}

html, body {
  overflow-x: hidden;
  -webkit-text-size-adjust: 100%;
}

body {
  min-height: 100vh;
  min-height: 100dvh;
  padding-bottom: env(safe-area-inset-bottom, 0px);
}

@layer base {
'''
if s.count(needle) != 1: raise SystemExit('CSS base insertion point not found')
s = s.replace(needle, insert, 1)
css.write_text(s)

app = Path('webapp/src/App.tsx')
s = app.read_text().replace(
    '<div className="max-w-7xl mx-auto px-6 h-[68px] flex items-center justify-between gap-8">',
    '<div className="w-full max-w-7xl mx-auto px-3 sm:px-6 min-h-[60px] sm:h-[68px] flex items-center justify-between gap-2 sm:gap-8">',
    1,
)
s = s.replace(
    '<div className="min-h-screen bg-[#0F1115] text-[#E5E7EB] flex flex-col">',
    '<div className="min-h-screen min-h-[100dvh] w-full overflow-x-hidden bg-[#0F1115] text-[#E5E7EB] flex flex-col">',
    1,
)
app.write_text(s)

# Version 17 = APK build 23, universal WebView build remains Android 6+.
gradle = Path('android/app/build.gradle.kts')
s = gradle.read_text()
import re
s2 = re.sub(r'versionCode = \\d+\\n\\s*versionName = "[^"]+"', 'versionCode = 17\\n        versionName = "1.1.6-netplay-zip-touch-fit"', s, count=1)
if s2 == s or 'versionCode = 17' not in s2:
    s2 = re.sub(r'versionCode = \d+\n\s*versionName = "[^"]+"', 'versionCode = 17\n        versionName = "1.1.6-netplay-zip-touch-fit"', s, count=1)
if 'versionCode = 17' not in s2: raise SystemExit('Could not bump APK version')
gradle.write_text(s2)
print('Patched multiplayer ZIP boot, touch fallback/propagation, and mobile viewport sizing.')
