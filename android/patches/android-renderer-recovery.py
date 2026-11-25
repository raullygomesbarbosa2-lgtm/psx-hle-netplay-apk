from pathlib import Path

p = Path('android/app/src/main/java/com/psxhle/netplay/MainActivity.kt')
s = p.read_text()
if 'private fun createGameWebView()' in s:
    print('WebView renderer recovery is already installed')
    raise SystemExit(0)
start = s.find('        web = WebView(this)\n', s.find('    override fun onCreate'))
end_line = '        web.loadUrl("https://appassets.androidplatform.net/index.html")\n'
end = s.find(end_line, start)
if start < 0 or end < 0:
    raise SystemExit('Could not locate WebView setup in MainActivity')
end += len(end_line)
block = s[start:end]
block = block.replace('        web = WebView(this)\n', '        val view = WebView(this)\n', 1)
block = block.replace('web.', 'view.')
block = block.replace('        setContentView(web)\n', '')
block = block.replace('        view.loadUrl("https://appassets.androidplatform.net/index.html")\n', '')
needle = '''            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val host = request.url.host.orEmpty()
                if (host == "appassets.androidplatform.net") return false
                return try {
                    startActivity(Intent(Intent.ACTION_VIEW, request.url))
                    true
                } catch (_: Throwable) { true }
            }
'''
replacement = needle + '''
            override fun onRenderProcessGone(view: WebView, detail: android.webkit.RenderProcessGoneDetail): Boolean {
                recoverAfterRendererExit(view)
                return true
            }
'''
if block.count(needle) != 1:
    raise SystemExit('Could not find WebView navigation callback for renderer recovery')
block = block.replace(needle, replacement, 1)
block += '        return view\n'
helper = '''    private fun createGameWebView(): WebView {
''' + block + '''    }

    private fun recoverAfterRendererExit(deadView: WebView) {
        runOnUiThread {
            if (isFinishing || (this::web.isInitialized && web !== deadView)) return@runOnUiThread
            pendingFileCallback?.onReceiveValue(null)
            pendingFileCallback = null
            runCatching { (deadView.parent as? android.view.ViewGroup)?.removeView(deadView) }
            runCatching { deadView.destroy() }
            web = createGameWebView()
            setContentView(web)
            Toast.makeText(this, "O navegador interno foi encerrado por falta de memória. Mantive o app aberto; libere memória e tente uma imagem menor.", Toast.LENGTH_LONG).show()
            web.loadUrl("https://appassets.androidplatform.net/index.html?rendererRestarted=1")
        }
    }

'''
# Replace block before inserting helper so source offsets cannot drift.
s = s[:start] + '''        web = createGameWebView()
        setContentView(web)
        web.loadUrl("https://appassets.androidplatform.net/index.html")
''' + s[end:]
needle_oncreate = '    override fun onCreate(savedInstanceState: Bundle?) {'
if s.count(needle_oncreate) != 1:
    raise SystemExit('onCreate insertion point not found')
s = s.replace(needle_oncreate, helper + needle_oncreate, 1)
p.write_text(s)
print('Added WebView renderer crash recovery so Chromium OOM does not close the native app Activity.')
