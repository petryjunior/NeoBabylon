package dev.neobabylon.webview

import android.content.SharedPreferences
import android.util.Log
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Syncs word memory via OpenAI Assistants API (instructions field).
 * Same API key on phone and Chrome = same assistant = shared history.
 */
object MemorySync {
    private const val TAG = "NeoBabylonMemorySync"
    private const val ASSISTANTS_API = "https://api.openai.com/v1/assistants"
    private const val ASSISTANTS_BETA = "assistants=v2"
    private const val MEMORY_ASSISTANT_NAME = "NeoBabylon Word Memory"
    private const val PREFS_SYNC_STATUS = "memory_sync_status_json"

    private val client =
        OkHttpClient.Builder()
            .connectTimeout(60, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .build()

    private val jsonMedia = "application/json; charset=utf-8".toMediaType()
    private val executor = Executors.newSingleThreadExecutor()

    fun schedule(prefs: SharedPreferences) {
        executor.execute { syncNow(prefs) }
    }

    fun syncNow(prefs: SharedPreferences) {
        val apiKey = normalizeApiKey(prefs.getString("apiKey", null).orEmpty())
        if (apiKey.isEmpty()) {
            saveSyncStatus(prefs, ok = false, error = "Add your OpenAI API key in settings to sync.")
            return
        }

        try {
            val assistant = findMemoryAssistant(apiKey)
            val localUpdatedAt = LookupMemory.getUpdatedAt(prefs)
            if (assistant != null) {
                val instructions = assistant.optString("instructions", "")
                if (instructions.isNotBlank()) {
                    val remote = parseRemotePayload(instructions)
                    when {
                        remote.updatedAt > localUpdatedAt ->
                            LookupMemory.applyRemoteSnapshot(
                                prefs,
                                remote.entries,
                                remote.updatedAt,
                            )
                        remote.updatedAt < localUpdatedAt -> {
                            /* Local clear or newer edits win. */
                        }
                        remote.entries.isNotEmpty() ->
                            LookupMemory.mergeRemoteJson(prefs, instructions)
                    }
                }
            }

            val entriesJson = LookupMemory.exportEntriesJson(prefs)
            val entryCount = JSONArray(entriesJson).length()
            val payloadUpdatedAt = LookupMemory.bumpUploadTimestamp(prefs)
            val payload =
                JSONObject()
                    .put("entries", JSONArray(entriesJson))
                    .put("updatedAt", payloadUpdatedAt)
                    .toString()

            if (assistant != null) {
                val id = assistant.optString("id")
                if (id.isNotEmpty()) {
                    updateMemoryAssistant(apiKey, id, payload)
                }
            } else {
                createMemoryAssistant(apiKey, payload)
            }

            saveSyncStatus(prefs, ok = true, error = null, entryCount = entryCount)
        } catch (e: Exception) {
            val msg = e.message ?: e.javaClass.simpleName
            Log.e(TAG, "sync failed: $msg", e)
            saveSyncStatus(prefs, ok = false, error = msg)
        }
    }

    private data class RemotePayload(
        val entries: List<LookupMemory.Entry>,
        val updatedAt: Long,
    )

    private fun parseRemotePayload(instructions: String): RemotePayload {
        val trimmed = instructions.trim()
        if (trimmed.isEmpty()) return RemotePayload(emptyList(), 0L)
        return try {
            when {
                trimmed.startsWith("[") -> {
                    RemotePayload(
                        parseEntriesArray(JSONArray(trimmed)),
                        0L,
                    )
                }
                else -> {
                    val o = JSONObject(trimmed)
                    val entries =
                        parseEntriesArray(o.optJSONArray("entries") ?: JSONArray())
                    val updatedAt =
                        if (o.has("updatedAt") && !o.isNull("updatedAt")) {
                            o.optLong("updatedAt", 0L)
                        } else {
                            0L
                        }
                    RemotePayload(entries, updatedAt)
                }
            }
        } catch (_: Exception) {
            RemotePayload(emptyList(), 0L)
        }
    }

    private fun parseEntriesArray(arr: JSONArray): List<LookupMemory.Entry> =
        buildList {
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                val word = o.optString("word", "").trim()
                val translation = o.optString("translation", "").trim()
                val ts = o.optLong("ts", 0L)
                if (word.isEmpty() || translation.isEmpty() || ts <= 0L) continue
                val id = o.optString("id", "").trim().ifEmpty { "${ts}_$i" }
                add(
                    LookupMemory.Entry(
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

    private fun normalizeApiKey(key: String): String = key.replace("\uFEFF", "").trim()

    private fun assistantHeaders(apiKey: String): Map<String, String> =
        mapOf(
            "Authorization" to "Bearer $apiKey",
            "OpenAI-Beta" to ASSISTANTS_BETA,
        )

    private fun listAssistants(apiKey: String): JSONArray {
        val req =
            Request.Builder()
                .url("$ASSISTANTS_API?limit=100&order=desc")
                .headers(assistantHeaders(apiKey).toHeaders())
                .get()
                .build()
        client.newCall(req).execute().use { res ->
            if (!res.isSuccessful) {
                throw IllegalStateException(
                    "OpenAI list assistants ${res.code}: ${res.body?.string().orEmpty().take(200)}",
                )
            }
            return JSONObject(res.body?.string().orEmpty()).optJSONArray("data") ?: JSONArray()
        }
    }

    private fun findMemoryAssistant(apiKey: String): JSONObject? {
        val all = listAssistants(apiKey)
        for (i in 0 until all.length()) {
            val a = all.getJSONObject(i)
            if (a.optString("name") == MEMORY_ASSISTANT_NAME ||
                a.optJSONObject("metadata")?.optString("neobabylon") == "word_memory"
            ) {
                return a
            }
        }
        return null
    }

    private fun createMemoryAssistant(apiKey: String, payload: String) {
        val body =
            JSONObject()
                .put("name", MEMORY_ASSISTANT_NAME)
                .put("model", "gpt-4o-mini")
                .put("instructions", payload)
                .put("tools", JSONArray())
                .put("metadata", JSONObject().put("neobabylon", "word_memory"))
                .toString()
        val req =
            Request.Builder()
                .url(ASSISTANTS_API)
                .headers(assistantHeaders(apiKey).toHeaders())
                .post(body.toRequestBody(jsonMedia))
                .build()
        client.newCall(req).execute().use { res ->
            if (!res.isSuccessful) {
                throw IllegalStateException(
                    "OpenAI create assistant ${res.code}: ${res.body?.string().orEmpty().take(200)}",
                )
            }
        }
    }

    private fun updateMemoryAssistant(apiKey: String, assistantId: String, payload: String) {
        val body = JSONObject().put("instructions", payload).toString()
        val req =
            Request.Builder()
                .url("$ASSISTANTS_API/$assistantId")
                .headers(assistantHeaders(apiKey).toHeaders())
                .post(body.toRequestBody(jsonMedia))
                .build()
        client.newCall(req).execute().use { res ->
            if (!res.isSuccessful) {
                throw IllegalStateException(
                    "OpenAI update assistant ${res.code}: ${res.body?.string().orEmpty().take(200)}",
                )
            }
        }
    }

    private fun Map<String, String>.toHeaders(): okhttp3.Headers {
        val b = okhttp3.Headers.Builder()
        for ((k, v) in this) b.add(k, v)
        return b.build()
    }

    private fun saveSyncStatus(
        prefs: SharedPreferences,
        ok: Boolean,
        error: String?,
        entryCount: Int = -1,
    ) {
        val o =
            JSONObject()
                .put("ok", ok)
                .put("error", error ?: JSONObject.NULL)
                .put("at", System.currentTimeMillis())
        if (entryCount >= 0) o.put("entryCount", entryCount)
        prefs.edit().putString(PREFS_SYNC_STATUS, o.toString()).apply()
    }
}
