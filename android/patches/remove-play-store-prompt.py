from pathlib import Path
p = Path('android/app/src/main/java/com/psxhle/netplay/MainActivity.kt')
s = p.read_text()
s = s.replace('    private var capabilityWarningShown = false\n', '')
s = s.replace('''        @JavascriptInterface
        fun openWebViewUpdatePage() {
            runOnUiThread { openWebViewUpdatePageInternal() }
        }

''', '')
start = s.find('''        @JavascriptInterface
        fun reportCapabilities(wasm: Boolean, webgl1: Boolean, webgl2: Boolean) {''')
if start < 0:
    raise SystemExit('Could not find capability dialog bridge')
end = s.find('\n        }\n    }\n', start)
if end < 0:
    raise SystemExit('Could not find end of capability bridge')
s = s[:start] + s[end + len('\n        }\n'):]
start = s.find('''    private fun openWebViewUpdatePageInternal() {''')
if start < 0:
    raise SystemExit('Could not find Play Store launcher')
end = s.find('''    private fun openDndSettingsPage() {''', start)
if end < 0:
    raise SystemExit('Could not find following DND function')
s = s[:start] + s[end:]
line = '                view.evaluateJavascript("(function(){try{var c=document.createElement(\'canvas\');var g1=!!(c.getContext(\'webgl\')||c.getContext(\'experimental-webgl\'));var g2=!!c.getContext(\'webgl2\');var w=typeof WebAssembly===\'object\';AndroidRuntime.reportCapabilities(w,g1,g2);}catch(e){AndroidRuntime.reportCapabilities(false,false,false);}})();", null)\n'
if line not in s:
    raise SystemExit('Could not find WebView capability script that prompts for Play Store')
s = s.replace(line, '')
p.write_text(s)

p = Path('webapp/src/emulator/psxWasmEngine.ts')
s = p.read_text()
needle = 'export function loadEjsRuntime(): Promise<void> {\n'
insert = '''export function loadEjsRuntime(): Promise<void> {
  if (typeof WebAssembly !== 'object') {
    return Promise.reject(
      new Error(
        'O aplicativo abre normalmente, mas este WebView do aparelho não oferece WebAssembly. Não precisa atualizar este APK pela Play Store; o núcleo PS1 atual depende desse recurso do sistema. Para rodar jogos neste Android será necessário um núcleo nativo compatível.',
      ),
    );
  }
'''
if s.count(needle) != 1:
    raise SystemExit('Could not find loadEjsRuntime')
s = s.replace(needle, insert)
p.write_text(s)

p = Path('android/app/build.gradle.kts')
s = p.read_text().replace('versionCode = 5\n        versionName = "1.0.4-android6-diagnostics"', 'versionCode = 6\n        versionName = "1.0.5-no-play-store-prompt"')
p.write_text(s)
print('Removed the Play Store update flow; unsupported WebAssembly is reported in the emulator screen instead.')
