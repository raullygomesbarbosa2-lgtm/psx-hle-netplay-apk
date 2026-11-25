package com.psxhle.netplay

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.JavascriptInterface
import android.webkit.ConsoleMessage
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader

class MainActivity : Activity() {
    private lateinit var web: WebView
    private var pendingFileCallback: ValueCallback<Array<Uri>>? = null

    private val filePickerRequest = 4701
    private var capabilityWarningShown = false

    private inner class RuntimeBridge {
        @JavascriptInterface
        fun reportCapabilities(wasm: Boolean, webgl1: Boolean, webgl2: Boolean) {
            runOnUiThread {
                if (capabilityWarningShown || (wasm && webgl1)) return@runOnUiThread
                capabilityWarningShown = true
                val missing = buildList {
                    if (!wasm) add("WebAssembly")
                    if (!webgl1) add("WebGL 1 / OpenGL ES 2")
                }.joinToString(" e ")
                android.app.AlertDialog.Builder(this@MainActivity)
                    .setTitle("Compatibilidade gráfica do Android")
                    .setMessage("Este WebView não disponibiliza $missing. Por isso a ISO pode ser reconhecida, mas o jogo aparecer preto. Atualiza o Android System WebView/Chrome pela Play Store e reabre o app. O APK aceita Android 6.0 (API 23), mas o WebView e o driver gráfico também precisam oferecer esses recursos.")
                    .setPositiveButton("Entendi", null)
                    .show()
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this)
        web.setBackgroundColor(android.graphics.Color.rgb(15, 17, 21))
        web.setLayerType(View.LAYER_TYPE_HARDWARE, null)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = false
            allowContentAccess = true
            mediaPlaybackRequiresUserGesture = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            javaScriptCanOpenWindowsAutomatically = true
            setSupportMultipleWindows(false)
        }
        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
        web.addJavascriptInterface(RuntimeBridge(), "AndroidRuntime")
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest) =
                loader.shouldInterceptRequest(request.url)

            override fun onPageFinished(view: WebView, url: String) {
                super.onPageFinished(view, url)
                view.evaluateJavascript("(function(){try{var c=document.createElement('canvas');var g1=!!(c.getContext('webgl')||c.getContext('experimental-webgl'));var g2=!!c.getContext('webgl2');var w=typeof WebAssembly==='object';AndroidRuntime.reportCapabilities(w,g1,g2);}catch(e){AndroidRuntime.reportCapabilities(false,false,false);}})();", null)
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val host = request.url.host.orEmpty()
                if (host == "appassets.androidplatform.net") return false
                return try {
                    startActivity(Intent(Intent.ACTION_VIEW, request.url))
                    true
                } catch (_: Throwable) { true }
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                pendingFileCallback?.onReceiveValue(null)
                pendingFileCallback = filePathCallback
                val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = "*/*"
                    putExtra(Intent.EXTRA_ALLOW_MULTIPLE, fileChooserParams?.mode == FileChooserParams.MODE_OPEN_MULTIPLE)
                }
                return try {
                    startActivityForResult(intent, filePickerRequest)
                    true
                } catch (_: Throwable) {
                    pendingFileCallback?.onReceiveValue(null)
                    pendingFileCallback = null
                    false
                }
            }
        }
        web.setDownloadListener { url, _, _, _, _ ->
            runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
        }
        web.overScrollMode = View.OVER_SCROLL_NEVER
        setContentView(web)
        web.loadUrl("https://appassets.androidplatform.net/index.html")
    }

    @Deprecated("Deprecated in Android API; kept for Android 6 compatibility")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == filePickerRequest) {
            val callback = pendingFileCallback
            pendingFileCallback = null
            if (resultCode == RESULT_OK && data != null) {
                val uris = data.clipData?.let { clip ->
                    Array(clip.itemCount) { i -> clip.getItemAt(i).uri }
                } ?: data.data?.let { arrayOf(it) }
                callback?.onReceiveValue(uris)
            } else callback?.onReceiveValue(null)
        }
    }

    override fun onBackPressed() {
        if (::web.isInitialized && web.canGoBack()) web.goBack() else super.onBackPressed()
    }

    override fun onDestroy() {
        pendingFileCallback?.onReceiveValue(null)
        pendingFileCallback = null
        if (::web.isInitialized) {
            web.stopLoading()
            web.loadUrl("about:blank")
            web.destroy()
        }
        super.onDestroy()
    }
}
