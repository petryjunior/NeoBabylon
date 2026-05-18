package dev.neobabylon.webview

import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject
import java.text.DateFormat
import java.util.Date
import java.util.Locale

object LookupMemory {
    private const val KEY = "lookup_memory_json"
    private const val RETENTION_MS = 7L * 24 * 60 * 60 * 1000
    private const val MAX_ENTRIES = 800

    data class Entry(
        val id: String,
        val word: String,
        val translation: String,
        val definition: String?,
        val ts: Long,
    )

    data class RepeatedGroup(
        val word: String,
        val count: Int,
        val entries: List<Entry>,
    )

    data class ViewModel(
        val repeated: List<RepeatedGroup>,
        val timeline: List<Entry>,
    )

    private fun normalizeKey(word: String): String = word.trim().lowercase(Locale.ROOT)

    fun load(prefs: SharedPreferences): List<Entry> {
        val raw = prefs.getString(KEY, null) ?: return emptyList()
        return try {
            val arr = JSONArray(raw)
            buildList {
                for (i in 0 until arr.length()) {
                    val o = arr.getJSONObject(i)
                    add(
                        Entry(
                            id = o.optString("id", ""),
                            word = o.optString("word", ""),
                            translation = o.optString("translation", ""),
                            definition =
                                if (o.isNull("definition")) {
                                    null
                                } else {
                                    o.optString("definition").takeIf { it.isNotBlank() }
                                },
                            ts = o.optLong("ts", 0L),
                        ),
                    )
                }
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    private fun save(prefs: SharedPreferences, entries: List<Entry>) {
        val arr = JSONArray()
        for (e in entries) {
            arr.put(
                JSONObject()
                    .put("id", e.id)
                    .put("word", e.word)
                    .put("translation", e.translation)
                    .put("definition", e.definition ?: JSONObject.NULL)
                    .put("ts", e.ts)
                    .put("scope", "word"),
            )
        }
        prefs.edit().putString(KEY, arr.toString()).apply()
    }

    private fun prune(entries: List<Entry>, now: Long = System.currentTimeMillis()): List<Entry> {
        val cutoff = now - RETENTION_MS
        return entries
            .filter { it.ts >= cutoff && it.word.isNotBlank() && it.translation.isNotBlank() }
            .take(MAX_ENTRIES)
    }

    fun record(
        prefs: SharedPreferences,
        word: String,
        translation: String,
        definition: String?,
    ) {
        val w = word.trim()
        val t = translation.trim()
        if (w.isEmpty() || t.isEmpty()) return

        val now = System.currentTimeMillis()
        val list = prune(load(prefs), now).toMutableList()
        list.add(
            0,
            Entry(
                id = "${now}_${(Math.random() * 1e9).toLong()}",
                word = w,
                translation = t,
                definition = definition?.trim()?.takeIf { it.isNotEmpty() },
                ts = now,
            ),
        )
        while (list.size > MAX_ENTRIES) {
            list.removeAt(list.size - 1)
        }
        save(prefs, list)
        MemorySync.schedule(prefs)
    }

    fun buildView(prefs: SharedPreferences): ViewModel {
        val entries = prune(load(prefs))
        save(prefs, entries)

        val byKey = linkedMapOf<String, MutableList<Entry>>()
        for (e in entries) {
            val k = normalizeKey(e.word)
            byKey.getOrPut(k) { mutableListOf() }.add(e)
        }

        val repeated =
            byKey.values
                .filter { it.size >= 2 }
                .map { list ->
                    val sorted = list.sortedByDescending { it.ts }
                    RepeatedGroup(
                        word = sorted.first().word,
                        count = sorted.size,
                        entries = sorted,
                    )
                }
                .sortedWith(
                    compareByDescending<RepeatedGroup> { it.count }
                        .thenByDescending { it.entries.first().ts },
                )

        val timeline = entries.sortedByDescending { it.ts }
        return ViewModel(repeated = repeated, timeline = timeline)
    }

    fun clear(prefs: SharedPreferences) {
        prefs.edit().remove(KEY).apply()
        MemorySync.schedule(prefs)
    }

    fun exportEntriesJson(prefs: SharedPreferences): String {
        val entries = prune(load(prefs))
        val arr = JSONArray()
        for (e in entries) {
            arr.put(entryToJson(e))
        }
        return arr.toString()
    }

    private fun entryToJson(e: Entry): JSONObject =
        JSONObject()
            .put("id", e.id)
            .put("word", e.word)
            .put("translation", e.translation)
            .put("definition", e.definition ?: JSONObject.NULL)
            .put("ts", e.ts)
            .put("scope", "word")

    fun mergeRemoteJson(prefs: SharedPreferences, json: String): Int {
        val root = json.trim()
        val imported =
            when {
                root.startsWith("{") -> {
                    val o = JSONObject(root)
                    parseEntriesArray(o.optJSONArray("entries") ?: JSONArray())
                }
                else -> parseEntriesFromJson(root)
            }
        if (imported.isEmpty()) return 0

        val existing = prune(load(prefs))
        val byId = linkedMapOf<String, Entry>()
        for (e in existing) {
            if (e.id.isNotEmpty()) byId[e.id] = e
        }

        var added = 0
        for (e in imported) {
            if (e.id.isNotEmpty() && byId.containsKey(e.id)) continue
            byId[e.id] = e
            added++
        }

        save(prefs, prune(byId.values.sortedByDescending { it.ts }))
        return added
    }

    private fun parseEntriesFromJson(json: String): List<Entry> {
        val trimmed = json.trim()
        if (trimmed.isEmpty()) return emptyList()
        return try {
            val arr =
                when {
                    trimmed.startsWith("[") -> JSONArray(trimmed)
                    else -> {
                        val root = JSONObject(trimmed)
                        root.optJSONArray("entries") ?: JSONArray()
                    }
                }
            parseEntriesArray(arr)
        } catch (_: Exception) {
            emptyList()
        }
    }

    private fun parseEntriesArray(arr: JSONArray): List<Entry> =
        buildList {
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                val word = o.optString("word", "").trim()
                val translation = o.optString("translation", "").trim()
                val ts = o.optLong("ts", 0L)
                if (word.isEmpty() || translation.isEmpty() || ts <= 0L) continue
                val id = o.optString("id", "").trim().ifEmpty { "${ts}_$i" }
                add(
                    Entry(
                        id = id,
                        word = word,
                        translation = translation,
                        definition =
                            if (o.isNull("definition")) {
                                null
                            } else {
                                o.optString("definition").trim().takeIf { it.isNotEmpty() }
                            },
                        ts = ts,
                    ),
                )
            }
        }

    fun formatWhen(ts: Long): String {
        val fmt = DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT, Locale.getDefault())
        return fmt.format(Date(ts))
    }
}
