from pathlib import Path
import re

panel = Path('webapp/src/components/NetPlayPanel.tsx')
s = panel.read_text()
old_import = '''import {
  checkBrowserWasmMemorySafety,
  loadEjsRuntime,
  PsxWasmEngine,
  WasmSafetyCheckResult,
} from '../emulator/psxWasmEngine';
'''
new_import = '''import {
  checkBrowserWasmMemorySafety,
  PsxWasmEngine,
  WasmSafetyCheckResult,
} from '../emulator/psxWasmEngine';
'''
if old_import not in s:
    raise SystemExit('Could not locate NetPlay emulator imports')
s = s.replace(old_import, new_import, 1)
old_call = '''    installGlobalAudioTap();
    void loadEjsRuntime().catch(() => {});
    const unsub = subscribeUserRooms(user.uid, (rooms) => {
'''
new_call = '''    installGlobalAudioTap();
    // P2 receives the P1 game stream and must not download/start the PS1 WASM runtime.
    // The P1 runtime is initialized only when the host explicitly loads a disc.
    const unsub = subscribeUserRooms(user.uid, (rooms) => {
'''
if s.count(old_call) != 1:
    raise SystemExit('Could not find the eager PS1 runtime load in NetPlay')
s = s.replace(old_call, new_call, 1)
panel.write_text(s)

# Exact maintenance: this patch only removes the guest-side runtime preload and updates APK version.
gradle = Path('android/app/build.gradle.kts')
s = gradle.read_text()
s = re.sub(r'versionCode = \d+\n\s*versionName = "[^"]+"', 'versionCode = 12\n        versionName = "1.1.1-p2-stream-only"', s, count=1)
if 'versionCode = 12' not in s:
    raise SystemExit('Could not bump APK versionCode')
gradle.write_text(s)
print('P2 no longer preloads the PS1 WASM runtime; the P1 still loads it when it opens a game.')
