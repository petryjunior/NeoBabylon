package dev.neobabylon.webview

import android.annotation.SuppressLint
import android.content.Intent
import android.content.SharedPreferences
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.util.Base64
import android.util.Log
import android.view.Menu
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.ArrayAdapter
import android.widget.Filter
import android.widget.Filterable
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.PopupMenu
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import com.google.android.material.textfield.MaterialAutoCompleteTextView
import com.google.android.material.textfield.TextInputLayout
import dev.neobabylon.webview.databinding.ActivityMainBinding

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var prefs: SharedPreferences

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        prefs = getSharedPreferences(NeoBridge.PREFS_NAME, MODE_PRIVATE)

        binding.refreshButton.setOnClickListener {
            binding.webView.reload()
        }

        binding.overflowButton.setOnClickListener { anchor ->
            PopupMenu(this, anchor).apply {
                menu.add(Menu.NONE, MENU_SETTINGS, Menu.NONE, getString(R.string.settings))
                setOnMenuItemClickListener { item ->
                    if (item.itemId == MENU_SETTINGS) {
                        startActivity(Intent(this@MainActivity, SettingsActivity::class.java))
                        true
                    } else {
                        false
                    }
                }
                show()
            }
        }

        setupUrlFieldEndIcon()
        setupUrlAutocomplete()

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
                    if (!url.isNullOrBlank() && !url.startsWith("about:")) {
                        binding.urlField.setText(url, false)
                        UrlHistory.add(prefs, url)
                        refreshUrlAutocomplete()
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

    private fun setupUrlFieldEndIcon() {
        val layout = binding.urlLayout
        val field = binding.urlField
        layout.endIconMode = TextInputLayout.END_ICON_CUSTOM
        layout.setEndIconDrawable(R.drawable.ic_clear_24)
        layout.setEndIconContentDescription(getString(R.string.clear_url))
        fun syncEndIcon() {
            layout.isEndIconVisible = field.hasFocus() || field.text?.isNotEmpty() == true
        }
        layout.setEndIconOnClickListener {
            field.setText("")
            field.requestFocus()
            syncEndIcon()
        }
        field.setOnFocusChangeListener { _, _ -> syncEndIcon() }
        field.addTextChangedListener(
            object : TextWatcher {
                override fun beforeTextChanged(
                    s: CharSequence?,
                    start: Int,
                    count: Int,
                    after: Int,
                ) {
                }

                override fun onTextChanged(
                    s: CharSequence?,
                    start: Int,
                    before: Int,
                    count: Int,
                ) {
                }

                override fun afterTextChanged(s: Editable?) {
                    syncEndIcon()
                }
            },
        )
        syncEndIcon()
    }

    private fun setupUrlAutocomplete() {
        val field = binding.urlField
        field.threshold = 0
        field.setOnClickListener {
            field.showDropDown()
            binding.urlLayout.isEndIconVisible =
                field.hasFocus() || field.text?.isNotEmpty() == true
        }
        field.setOnFocusChangeListener { v, hasFocus ->
            if (hasFocus) {
                (v as MaterialAutoCompleteTextView).showDropDown()
            }
            binding.urlLayout.isEndIconVisible =
                hasFocus || field.text?.isNotEmpty() == true
        }
        field.setOnItemClickListener { _, _, position, _ ->
            val u = field.adapter.getItem(position) as String
            field.setText(u, false)
            loadFromField()
        }
        refreshUrlAutocomplete()
    }

    private fun refreshUrlAutocomplete() {
        val snapshot = UrlHistory.load(prefs)
        val adapter = UrlHistoryAdapter(this, snapshot)
        binding.urlField.setAdapter(adapter)
        adapter.filter.filter(null)
    }

    private fun loadFromField() {
        var url = binding.urlField.text?.toString()?.trim().orEmpty()
        if (url.isEmpty()) {
            return
        }
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            url = "https://$url"
        }
        binding.urlField.setText(url, false)
        UrlHistory.add(prefs, url)
        refreshUrlAutocomplete()
        binding.webView.loadUrl(url)
    }

    private fun injectNeoScript(webView: WebView) {
        try {
            val bytes = webView.context.assets.open("inject.js").readBytes()
            val b64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
            // atob() alone corrupts UTF-8 in the script; decode bytes as UTF-8 before eval.
            val js =
                "(function(){try{" +
                    "var b='$b64';" +
                    "var bin=atob(b);" +
                    "var a=new Uint8Array(bin.length);" +
                    "for(var i=0;i<bin.length;i++){a[i]=bin.charCodeAt(i)&0xff;}" +
                    "var s=new TextDecoder('utf-8').decode(a);" +
                    "eval(s);" +
                    "}catch(e){console.error('NeoBabylon inject',e);}" +
                    "})();"
            webView.evaluateJavascript(js, null)
        } catch (e: Exception) {
            Log.e("NeoBabylon", "inject failed", e)
        }
    }

    /**
     * Shows recent URLs on empty focus; filters by substring when typing.
     */
    private class UrlHistoryAdapter(
        context: android.content.Context,
        private val snapshot: List<String>,
    ) : ArrayAdapter<String>(context, android.R.layout.simple_list_item_1, snapshot.toMutableList()),
        Filterable {
        private val filter =
            object : Filter() {
                override fun performFiltering(constraint: CharSequence?): FilterResults {
                    val q = constraint?.toString()?.trim().orEmpty()
                    val match =
                        if (q.isEmpty()) {
                            snapshot
                        } else {
                            snapshot.filter { it.contains(q, ignoreCase = true) }
                        }
                    return FilterResults().apply {
                        values = match
                        count = match.size
                    }
                }

                override fun publishResults(constraint: CharSequence?, results: FilterResults?) {
                    clear()
                    @Suppress("UNCHECKED_CAST")
                    val list = (results?.values as? List<String>).orEmpty()
                    addAll(list)
                    notifyDataSetChanged()
                }
            }

        override fun getFilter(): Filter = filter
    }

    companion object {
        private const val MENU_SETTINGS = 1
    }
}
