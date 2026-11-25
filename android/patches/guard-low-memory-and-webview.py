from pathlib import Path
import re

# Avoid pinning the entire WebView into a hardware texture on Android 6: on older GPUs this
# can leave the page black and wastes scarce graphics memory. Keep the platform's default layers.
activity = Path('android/app/src/main/java/com/psxhle/netplay/MainActivity.kt')
s = activity.read_text()
needle = '''    private inner class RuntimeBridge {
'''
if needle not in s:
    raise SystemExit('Could not find RuntimeBridge')
bridge = '''    private inner class RuntimeBridge {
        @JavascriptInterface
        fun getAvailableHeapMb(): Int {
            val runtime = Runtime.getRuntime()
            val available = runtime.maxMemory() - (runtime.totalMemory() - runtime.freeMemory())
            return (available / (1024L * 1024L)).coerceAtLeast(0L).toInt()
        }

'''
s = s.replace(needle, bridge, 1)
s = s.replace('        web.setLayerType(View.LAYER_TYPE_HARDWARE, null)\n', '        web.setLayerType(View.LAYER_TYPE_NONE, null)\n')
activity.write_text(s)

engine = Path('webapp/src/emulator/psxWasmEngine.ts')
s = engine.read_text()
needle = '''  if (isCompressedArchive) {
'''
insert = '''  // EmulatorJS currently stages a whole disc in the WebView/WASM filesystem. On low-RAM
  // Android this can kill the whole app and return the user to the launcher. Use the Android
  // process heap as a conservative admission estimate before starting that allocation.
  let nativeHeapMb = 0;
  try {
    const bridge = (window as Window & { AndroidRuntime?: { getAvailableHeapMb?: () => number } }).AndroidRuntime;
    nativeHeapMb = Number(bridge?.getAvailableHeapMb?.() ?? 0);
  } catch {
    nativeHeapMb = 0;
  }
  if (nativeHeapMb > 0 && !isCompressedArchive) {
    const safeDiscMb = Math.max(0, Math.floor((nativeHeapMb - 40) / 2.5));
    if (sizeMb > safeDiscMb) {
      return {
        blockedReason: `Não iniciei este disco de ${sizeMb.toFixed(1)} MB para evitar que o aplicativo feche e volte à tela inicial: a memória disponível agora é insuficiente para o núcleo WebView carregar o arquivo inteiro. Esta versão ainda não tem leitura nativa em blocos para jogos desse tamanho.`,
        requiresStreamingPrompt: false,
        hardBlockWasm: true,
        sizeMb,
        limitMb: safeDiscMb,
        hardLimitMb: safeDiscMb,
        isMobile,
      };
    }
  }

  if (isCompressedArchive) {
'''
if s.count(needle) != 1:
    raise SystemExit('Could not find archive branch in memory check')
s = s.replace(needle, insert, 1)
engine.write_text(s)

# Remove inaccurate "any size" claims from UI copy for the WebView implementation.
for path in [Path('webapp/index.html'), Path('webapp/src/components/AuthGate.tsx')]:
    text = path.read_text()
    text = text.replace('ISOs de qualquer tamanho', 'imagens de disco PS1')
    text = text.replace('discos de qualquer tamanho', 'imagens de disco PS1')
    path.write_text(text)

# Bump package version for the user's existing installed build.
gradle = Path('android/app/build.gradle.kts')
s = gradle.read_text()
s = re.sub(r'versionCode = \d+\n\s*versionName = "[^"]+"', 'versionCode = 9\n        versionName = "1.0.8-android6-safe-memory"', s, count=1)
if 'versionCode = 9' not in s:
    raise SystemExit('Could not bump APK versionCode')
gradle.write_text(s)
print('Added a conservative native-memory guard, removed forced hardware WebView layer, and bumped version.')
