package dev.neobabylon.webview

import android.annotation.SuppressLint
import android.content.Intent
import android.os.Bundle
import android.util.Base64
import android.util.Log
import android.view.View
import android.view.inputmethod.EditorInfo
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import dev.neobabylon.webview.databinding.ActivityMainBinding

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.settingsButton.setOnClickListener {
            startActivity(Intent(this, SettingsActivity::class.java))
        }

        val settings = binding.webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.setSupportZoom(true)
        settings.builtInZoomControls = true
        settings.displayZoomControls = false
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true

        binding.webView.webChromeClient =
            object : WebChromeClient() {
                override fun onProgressChanged(view: WebView?, newProgress: Int) {
                    super.onProgressChanged(view, newProgress)
                    if (newProgress in 1..99) {
                        binding.progressBar.visibility = View.VISIBLE
                        binding.progressBar.progress = newProgress
                    } else {
                        binding.progressBar.visibility = View.GONE
                    }
                }
            }
        binding.webView.addJavascriptInterface(NeoBridge(this, binding.webView), "NeoAndroid")
        binding.webView.webViewClient =
            object : WebViewClient() {
                override fun onPageFinished(view: WebView?, url: String?) {
                    super.onPageFinished(view, url)
                    view ?: return
                    if (!url.isNullOrBlank()) {
                        binding.urlField.setText(url)
                    }
                    injectNeoScript(view)
                }
            }

        binding.goButton.setOnClickListener { loadFromField() }
        binding.urlField.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_GO) {
                loadFromField()
                true
            } else {
                false
            }
        }

        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    if (binding.webView.canGoBack()) {
                        binding.webView.goBack()
                    } else {
                        finish()
                    }
                }
            },
        )

        loadFromField()
    }

    private fun loadFromField() {
        var url = binding.urlField.text?.toString()?.trim().orEmpty()
        if (url.isEmpty()) {
            return
        }
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            url = "https://$url"
        }
        binding.urlField.setText(url)
        binding.webView.loadUrl(url)
    }

    private fun injectNeoScript(webView: WebView) {
        try {
            val bytes = webView.context.assets.open("inject.js").readBytes()
            val b64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
            webView.evaluateJavascript(
                "(function(){try{eval(atob('$b64'));}catch(e){console.error('NeoBabylon inject',e);}})();",
                null,
            )
        } catch (e: Exception) {
            Log.e("NeoBabylon", "inject failed", e)
        }
    }
}
