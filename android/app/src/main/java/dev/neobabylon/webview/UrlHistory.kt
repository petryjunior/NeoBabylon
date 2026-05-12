package dev.neobabylon.webview

import android.content.SharedPreferences
import org.json.JSONArray

object UrlHistory {
    private const val KEY = "url_history_json"
    private const val MAX = 30

    fun load(prefs: SharedPreferences): List<String> {
        val raw = prefs.getString(KEY, null) ?: return emptyList()
        return try {
            val arr = JSONArray(raw)
            buildList {
                for (i in 0 until arr.length()) {
                    add(arr.getString(i))
                }
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    fun add(prefs: SharedPreferences, url: String) {
        val u = url.trim()
        if (!u.startsWith("http://") && !u.startsWith("https://")) {
            return
        }
        val list = load(prefs).toMutableList()
        list.removeAll { it.equals(u, ignoreCase = true) }
        list.add(0, u)
        while (list.size > MAX) {
            list.removeAt(list.size - 1)
        }
        val arr = JSONArray()
        for (item in list) {
            arr.put(item)
        }
        prefs.edit().putString(KEY, arr.toString()).apply()
    }
}
