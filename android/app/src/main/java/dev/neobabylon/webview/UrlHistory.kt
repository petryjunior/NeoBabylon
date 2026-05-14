package dev.neobabylon.webview

import android.content.SharedPreferences
import java.net.URI
import org.json.JSONArray

object UrlHistory {
    private const val KEY = "url_history_json"
    private const val MAX = 30

    /**
     * Scheme + host (lowercased) + optional non-default port + trailing slash.
     * Drops path, query, and fragment so history is one row per site, not per page.
     */
    fun normalizeOrigin(url: String): String? {
        val trimmed = url.trim()
        if (trimmed.isEmpty()) return null
        return try {
            val uri = URI(trimmed)
            val scheme = uri.scheme?.lowercase() ?: return null
            if (scheme != "http" && scheme != "https") return null
            val host = uri.host?.lowercase() ?: return null
            val port = uri.port
            val defaultPort = if (scheme == "https") 443 else 80
            val authority =
                if (port > 0 && port != defaultPort) "$host:$port" else host
            "$scheme://$authority/"
        } catch (_: Exception) {
            null
        }
    }

    fun load(prefs: SharedPreferences): List<String> {
        val raw = prefs.getString(KEY, null) ?: return emptyList()
        val parsed =
            try {
                val arr = JSONArray(raw)
                buildList {
                    for (i in 0 until arr.length()) {
                        add(arr.getString(i))
                    }
                }
            } catch (_: Exception) {
                emptyList()
            }
        return parsed
            .mapNotNull { entry ->
                normalizeOrigin(entry) ?: entry.trim().takeIf { it.isNotEmpty() }
            }
            .distinctBy { it.lowercase() }
    }

    fun add(prefs: SharedPreferences, url: String) {
        val origin = normalizeOrigin(url) ?: return
        val list = load(prefs).toMutableList()
        list.removeAll { it.equals(origin, ignoreCase = true) }
        list.add(0, origin)
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
