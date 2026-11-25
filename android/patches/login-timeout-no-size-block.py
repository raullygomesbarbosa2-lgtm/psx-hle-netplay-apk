from pathlib import Path
import re

# Keep the legacy Vite bundle, but remove the native-heap file-size rejection added in build 12.
# The user asks the core to attempt both small and large disc images; no fixed size cut-off.
engine = Path('webapp/src/emulator/psxWasmEngine.ts')
s = engine.read_text()
start = s.find('  // EmulatorJS currently stages a whole disc in the WebView/WASM filesystem.')
end = s.find('  if (isCompressedArchive) {', start)
if start >= 0 and end > start:
    s = s[:start] + '''  // Do not reject a disc by a guessed MB threshold. Pass valid uncompressed images of any
  // size to the PS1 core; actual capacity still depends on Android/WebView memory.
''' + s[end:]
elif start >= 0:
    raise SystemExit('Could not find end of native memory guard')
engine.write_text(s)

# AuthGate was hidden until Firebase's first auth callback. On older WebViews or slow networks
# that callback can be delayed; make the existing login/register UI visible after a short wait.
app = Path('webapp/src/App.tsx')
s = app.read_text()
needle = '''  useEffect(() => {
    const unsub = onIdTokenChanged(auth, async (u) => {
'''
replacement = '''  useEffect(() => {
    const authUiFallback = window.setTimeout(() => {
      setAuthReady(true);
    }, 5000);
    const unsub = onIdTokenChanged(auth, async (u) => {
'''
if s.count(needle) != 1:
    raise SystemExit('Could not find auth observer in App.tsx')
s = s.replace(needle, replacement, 1)
needle = '''    return () => unsub();
  }, [syncVerifiedProfile]);
'''
replacement = '''    return () => {
      window.clearTimeout(authUiFallback);
      unsub();
    };
  }, [syncVerifiedProfile]);
'''
if s.count(needle) != 1:
    raise SystemExit('Could not find auth observer cleanup')
s = s.replace(needle, replacement, 1)
app.write_text(s)

# Improve the busy state shown while Firebase is being initialized, and clarify the fallback.
app = Path('webapp/src/App.tsx')
s = app.read_text().replace(
    'Inicializando autenticação Firebase...',
    'Carregando login…',
)
app.write_text(s)

# Bump version for the next installable APK.
gradle = Path('android/app/build.gradle.kts')
s = gradle.read_text()
s = re.sub(r'versionCode = \\d+\\n\\s*versionName = "[^"]+"', 'versionCode = 11\\n        versionName = "1.1.0-login-timeout-no-size-gate"', s, count=1)
if 'versionCode = 11' not in s:
    s = re.sub(r'versionCode = \d+\n\s*versionName = "[^"]+"', 'versionCode = 11\n        versionName = "1.1.0-login-timeout-no-size-gate"', s, count=1)
if 'versionCode = 11' not in s:
    raise SystemExit('Could not bump APK versionCode')
gradle.write_text(s)
print('Added a Firebase login UI timeout fallback and removed the guessed file-size rejection.')
