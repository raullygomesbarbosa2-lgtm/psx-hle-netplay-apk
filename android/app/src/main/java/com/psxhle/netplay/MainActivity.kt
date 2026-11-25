package com.psxhle.netplay

import android.app.Activity
import android.app.NotificationManager
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.Toast
import android.app.AlertDialog
import android.content.Context
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
    private val privacyPrefs by lazy { getSharedPreferences("remote_privacy", Context.MODE_PRIVATE) }
    private var capabilityWarningShown = false
    private var dndAccessPromptShown = false
    private var pendingDndActivation = false
    private var pendingDndRestore = false
    private var remoteSessionRequested = false

    private inner class RuntimeBridge {
        @JavascriptInterface
        fun setRemoteSessionActive(active: Boolean) {
            runOnUiThread {
                remoteSessionRequested = active
                if (active) activateTemporaryDndOrAsk() else restorePreviousDndFilter()
            }
        }

        @JavascriptInterface
        fun openDndAccessSettings() {
            runOnUiThread { openDndSettingsPage() }
        }

        @JavascriptInterface
        fun openWebViewUpdatePage() {
            runOnUiThread { openWebViewUpdatePageInternal() }
        }

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
                    .setTitle("Compatibilidade do emulador neste aparelho")
                    .setMessage("O componente web atual do aparelho não oferece $missing. O APK instala no Android 6.0, mas esta versão baseada em WebView precisa de WebAssembly e WebGL 1 para executar o núcleo PS1; sem eles, uma ISO pode ser identificada e a tela do jogo continuar preta. Vou abrir a página para verificar se há atualização do Android System WebView disponível. Se não houver, este WebView não consegue executar o núcleo; será necessária uma versão com emulação nativa para esse aparelho.")
                    .setPositiveButton(if (!wasm) "Ver atualização" else "Entendi") { _, _ ->
                        if (!wasm) openWebViewUpdatePageInternal()
                    }
                    .setNegativeButton("Fechar", null)
                    .show()
            }
        }
    }

    private fun notificationManager(): NotificationManager? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager else null

    private fun hasDndAccess(): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && notificationManager()?.isNotificationPolicyAccessGranted == true

    private fun activateTemporaryDndOrAsk() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return
        if (privacyPrefs.getBoolean("active", false)) return
        if (!hasDndAccess()) {
            pendingDndActivation = true
            if (!dndAccessPromptShown) {
                dndAccessPromptShown = true
                AlertDialog.Builder(this)
                    .setTitle("Ativar proteção de notificações?")
                    .setMessage("Com sua autorização, o app ativa Não Perturbe temporariamente durante o jogo e restaura o modo anterior ao encerrar. Sem essa autorização, a transmissão continua enviando apenas o canvas do jogo, mas notificações ainda podem aparecer neste aparelho.")
                    .setPositiveButton("Configurar") { _, _ -> openDndSettingsPage() }
                    .setNegativeButton("Agora não") { _, _ -> pendingDndActivation = false }
                    .setOnCancelListener { pendingDndActivation = false }
                    .show()
            }
            return
        }
        pendingDndActivation = false
        val manager = notificationManager() ?: return
        try {
            val previous = manager.currentInterruptionFilter
            privacyPrefs.edit().putInt("previous_filter", previous).putBoolean("active", true).apply()
            manager.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_NONE)
        } catch (_: SecurityException) {
            privacyPrefs.edit().putBoolean("active", false).apply()
            Toast.makeText(this, "Não foi possível ativar Não Perturbe. A transmissão segue restrita ao jogo.", Toast.LENGTH_LONG).show()
        } catch (_: Throwable) {
            privacyPrefs.edit().putBoolean("active", false).apply()
        }
    }

    private fun restorePreviousDndFilter() {
        pendingDndActivation = false
        if (!privacyPrefs.getBoolean("active", false)) return
        if (!hasDndAccess()) {
            pendingDndRestore = true
            return
        }
        try {
            val previous = privacyPrefs.getInt("previous_filter", NotificationManager.INTERRUPTION_FILTER_ALL)
            notificationManager()?.setInterruptionFilter(previous)
        } catch (_: Throwable) {
            // Keep the persisted marker so a later resume can retry restoration.
            pendingDndRestore = true
            return
        }
        privacyPrefs.edit().putBoolean("active", false).remove("previous_filter").apply()
        pendingDndRestore = false
    }

    private fun openWebViewUpdatePageInternal() {
        val storeIntent = Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=com.google.android.webview"))
        try {
            startActivity(storeIntent)
        } catch (_: Throwable) {
            try {
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=com.google.android.webview")))
            } catch (_: Throwable) {
                Toast.makeText(this, "A Play Store não está disponível neste aparelho.", Toast.LENGTH_LONG).show()
            }
        }
    }

    private fun openDndSettingsPage() {
        if (remoteSessionRequested && !privacyPrefs.getBoolean("active", false)) pendingDndActivation = true
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            Toast.makeText(this, "O Não Perturbe automático precisa do Android 6.0 ou superior.", Toast.LENGTH_LONG).show()
            return
        }
        try {
            startActivity(Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS))
        } catch (_: Throwable) {
            Toast.makeText(this, "Não foi possível abrir a autorização do Não Perturbe. A transmissão continua restrita ao jogo.", Toast.LENGTH_LONG).show()
        }
    }

    override fun onResume() {
        super.onResume()
        if (pendingDndRestore && hasDndAccess()) restorePreviousDndFilter()
        if (pendingDndActivation && hasDndAccess()) activateTemporaryDndOrAsk()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (privacyPrefs.getBoolean("active", false)) {
            pendingDndRestore = true
            restorePreviousDndFilter()
        }
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
        restorePreviousDndFilter()
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
