from pathlib import Path

view = Path('webapp/src/components/AndroidHleSdkView.tsx')
s = view.read_text()
start = s.find('  const downloadBundle = () => {')
end = s.find('\n\n  const activeSnippet =', start)
if start >= 0 and end >= 0:
    s = s[:start] + s[end+2:]
s = s.replace(
    'O ambiente do AI Studio executa aplicativos Web em navegador (Canvas + WebAssembly + WebAudio, sem WebView/iframe). Para gerar um APK nativo sem navegador no Android Studio, baixe os fontes Kotlin + NDK C++ abaixo com seletor SAF para ROMs baixadas na pasta Downloads.',
    'Os trechos abaixo são exemplos de integração e NÃO são um emulador Android nativo completo. O app nativo real é um APK separado: usa LibretroDroid, sem WebView, e seu fluxo multiplayer é diferente do Remote Play do site (cada aparelho abre uma ISO local idêntica; sincronização de partida não foi comprovada).',
)
old_button = '''          <button
            type="button"
            onClick={downloadBundle}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-4 h-4" />
            Baixar Pacote SDK Android
          </button>
'''
new_button = '''          <a
            href="https://github.com/raullygomesbarbosa2-lgtm/psx-hle-netplay-android/releases/download/psx-hle-native-build-72/app-debug.apk"
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-4 h-4" />
            Baixar APK nativo
          </a>
'''
if old_button in s:
    s = s.replace(old_button, new_button, 1)
elif 'Baixar APK nativo' not in s:
    raise SystemExit('Could not replace SDK sample downloader')
old_summary = '''          <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#262B36] text-xs text-slate-400">
            <span className="inline-flex items-center gap-2 font-mono">
              <Code2 className="w-3.5 h-3.5 text-blue-400" />
              {tab === 'activity'
                ? 'Android SDK · OpenDocument (Downloads) + SurfaceView'
                : tab === 'kotlin'
                  ? 'Android SDK · Kotlin SurfaceView + ParcelFileDescriptor'
                  : tab === 'cpp'
                    ? 'Android NDK · C++ JNI ANativeWindow + pread64'
                    : 'CMake · Biblioteca nativa libpsx_hle_native.so'}
            </span>
            <span>Zero WebView</span>
          </div>
'''
new_summary = '''          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-[#262B36] text-xs text-slate-400">
            <span className="inline-flex items-center gap-2 font-mono">
              <Code2 className="w-3.5 h-3.5 text-blue-400" />
              EXEMPLO DE CÓDIGO · NÃO É O NÚCLEO COMPLETO
            </span>
            <span>{tab === 'activity' ? 'MainActivity · exemplo' : tab === 'kotlin' ? 'Kotlin · exemplo' : tab === 'cpp' ? 'C++ JNI · exemplo' : 'CMake · exemplo'}</span>
            <span>Zero WebView</span>
          </div>
'''
if old_summary in s:
    s = s.replace(old_summary, new_summary, 1)
elif 'EXEMPLO DE CÓDIGO · NÃO É O NÚCLEO COMPLETO' not in s:
    raise SystemExit('Could not label SDK code samples')
view.write_text(s)

app = Path('webapp/src/App.tsx')
s = app.read_text().replace('<main className="flex-1">', '<main className="flex-1 w-full min-w-0 overflow-x-hidden">', 1)
app.write_text(s)
print('Linked the real native APK and marked SDK snippets as examples; tightened mobile content width.')
