package dev.neobabylon.webview

import android.annotation.SuppressLint
import android.content.Intent
import android.os.Bundle
import android.util.Base64
import android.util.Log
import android.view.MenuItem
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
        setSupportActionBar(binding.toolbar)

        binding.toolbar.inflateMenu(R.menu.main_menu)
        binding.toolbar.setOnMenuItemClickListener(::onToolbarMenu)

        val settings = binding.webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.setSupportZoom(true)
        settings.builtInZoomControls = true
        settings.displayZoomControls = false

        binding.webView.webChromeClient = WebChromeClient()
        binding.webView.addJavascriptInterface(NeoBridge(this, binding.webView), "NeoAndroid")
        binding.webView.webViewClient =
            object : WebViewClient() {
                override fun onPageFinished(view: WebView?, url: String?) {
                    super.onPageFinished(view, url)
                    view ?: return
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

    private fun onToolbarMenu(item: MenuItem): Boolean {
        if (item.itemId == R.id.action_settings) {
            startActivity(Intent(this, SettingsActivity::class.java))
            return true
        }
        return false
    }

    private fun loadFromField() {
        var url = binding.urlField.text?.toString()?.trim().orEmpty()
        if (url.isEmpty()) {
            return
        }
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            url = "https://$url"
        }
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
