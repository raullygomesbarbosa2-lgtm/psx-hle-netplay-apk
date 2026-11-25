from pathlib import Path
import re

# Expose Android's current free system memory to the web app (measured live, no model lookup).
activity = Path('android/app/src/main/java/com/psxhle/netplay/MainActivity.kt')
s = activity.read_text()
needle = '''        @JavascriptInterface
        fun getAvailableHeapMb(): Int {
'''
if needle not in s:
    raise SystemExit('Could not find AndroidRuntime memory bridge')
insert = '''        @JavascriptInterface
        fun getAvailableSystemMemoryMb(): Int {
            return try {
                val manager = getSystemService(ACTIVITY_SERVICE) as android.app.ActivityManager
                val info = android.app.ActivityManager.MemoryInfo()
                manager.getMemoryInfo(info)
                (info.availMem / (1024L * 1024L)).coerceAtLeast(0L).toInt()
            } catch (_: Throwable) {
                0
            }
        }

        @JavascriptInterface
        fun getAvailableHeapMb(): Int {
'''
s = s.replace(needle, insert, 1)
activity.write_text(s)

engine = Path('webapp/src/emulator/psxWasmEngine.ts')
s = engine.read_text()
needle = '''  if (isCompressedArchive) {
'''
if s.count(needle) != 1:
    raise SystemExit(f'Could not find disc safety branch: {s.count(needle)}')
insert = '''  // WASM and the virtual disc may coexist in RAM. Before starting the emulator, read
  // Android's current free system memory so Android does not kill the app without a JS error.
  // Estimate two disc copies plus core/renderer headroom; this is dynamic, not a fixed ISO cap.
  let availableSystemMb = 0;
  try {
    const bridge = (window as Window & {
      AndroidRuntime?: { getAvailableSystemMemoryMb?: () => number };
    }).AndroidRuntime;
    availableSystemMb = Number(bridge?.getAvailableSystemMemoryMb?.() ?? 0);
  } catch {
    availableSystemMb = 0;
  }
  if (isMobile && availableSystemMb > 0 && !isCompressedArchive) {
    const requiredSystemMb = Math.ceil(Math.max(320, sizeMb * 2 + 180));
    if (availableSystemMb < requiredSystemMb) {
      const availableText = Math.round(availableSystemMb);
      return {
        blockedReason: `Parei antes de iniciar para o Android não fechar o app. Agora há cerca de ${availableText} MB de RAM livre; este núcleo precisa de aproximadamente ${requiredSystemMb} MB livres para abrir esta imagem de ${sizeMb.toFixed(1)} MB. Feche outros apps e tente de novo; se continuar, use um arquivo CHD/PBP menor ou um aparelho com mais RAM livre. A ISO foi reconhecida, mas não foi iniciada.`,
        requiresStreamingPrompt: false,
        hardBlockWasm: true,
        sizeMb,
        limitMb: Math.max(0, Math.floor((availableSystemMb - 180) / 2)),
        hardLimitMb: Math.max(0, Math.floor((availableSystemMb - 180) / 2)),
        isMobile,
      };
    }
  }

  if (isCompressedArchive) {
'''
s = s.replace(needle, insert, 1)
engine.write_text(s)

# Version 22 is the same universal APK line, still minSdk 23 / Android 6+.
gradle = Path('android/app/build.gradle.kts')
s = gradle.read_text()
s2 = re.sub(r'versionCode = \d+\n\s*versionName = "[^"]+"', 'versionCode = 16\n        versionName = "1.1.5-live-memory-preflight"', s, count=1)
if s2 == s or 'versionCode = 16' not in s2:
    raise SystemExit('Could not bump APK version')
gradle.write_text(s2)
print('Added live free-RAM preflight before the shared Solo/NetPlay PS1 WASM mount.')
