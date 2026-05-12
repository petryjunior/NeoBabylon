package dev.neobabylon.webview

import android.annotation.SuppressLint
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject
import java.util.concurrent.Executors

@SuppressLint("JavascriptInterface")
class NeoBridge(
    private val activity: AppCompatActivity,
    private val webView: WebView,
) {
    private val executor = Executors.newSingleThreadExecutor()

    @JavascriptInterface
    fun translateAsync(payloadJson: String, callbackId: String) {
        // JS uses ids like "_neo_123_456" — must keep underscores or the callback name won't match window[cbId].
        val safe = callbackId.filter { it.isLetterOrDigit() || it == '_' }
        if (safe.isEmpty()) {
            return
        }
        val prefs = activity.getSharedPreferences(PREFS_NAME, AppCompatActivity.MODE_PRIVATE)
        executor.execute {
            val responseJson =
                try {
                    val payload = JSONObject(payloadJson)
                    val word = payload.getString("word")
                    val context = payload.optString("context", word)
                    val result = OpenAi.translate(prefs, word, context)
                    JSONObject().put("ok", true).put("result", result).toString()
                } catch (e: Exception) {
                    JSONObject()
                        .put("ok", false)
                        .put("error", e.message ?: "Unknown error")
                        .toString()
                }
            val quoted = JSONObject.quote(responseJson)
            activity.runOnUiThread {
                webView.evaluateJavascript(
                    "try{if(typeof window['$safe']==='function'){window['$safe'](JSON.parse($quoted));}}catch(e){console.error(e);}",
                    null,
                )
            }
        }
    }

    companion object {
        const val PREFS_NAME = "neobabylon"
    }
}
