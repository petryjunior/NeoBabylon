package dev.neobabylon.webview

import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets

object OpenAi {
    private const val API = "https://api.openai.com/v1/chat/completions"

    fun translate(
        prefs: SharedPreferences,
        word: String,
        context: String,
        sentenceMode: Boolean = false,
    ): JSONObject {
        val apiKey = prefs.getString("apiKey", null)?.trim().orEmpty()
        if (apiKey.isEmpty()) {
            throw IllegalStateException("Set your OpenAI API key in NeoBabylon settings.")
        }
        val targetLang =
            prefs.getString("targetLang", null)?.trim().orEmpty().ifEmpty { "English" }

        val system =
            if (sentenceMode) {
                listOf(
                    "You translate passages from web pages.",
                    "The user highlighted a short passage around a tapped word. Translate the ENTIRE passage into the requested target language.",
                    "Preserve meaning and natural tone; output fluent prose, not a word-by-word gloss.",
                    """Respond with JSON only: {"translation": string, "definition": null}.""",
                    """Always set "definition" to null.""",
                ).joinToString(" ")
            } else {
                val multiword =
                    "Detect whether the surface word belongs to a phrasal verb, separable verb, " +
                        "verb+particle idiom, or similar multi-word verbal expression in the context " +
                        "(particle may be adjacent or separated across words)."
                listOf(
                    "You help users understand words on web pages.",
                    "Given a surface word and a short surrounding context, respond with JSON only.",
                    """Schema: {"translation": string, "definition": string}.""",
                    "Both fields are required. definition must be a non-empty string in the TARGET language " +
                        """(never JSON null, never the literal text "null", never an empty string).""",
                    multiword,
                    "translation: natural target-language equivalent for how the surface word reads in this sentence; " +
                        "if it participates in such a multi-word verbal unit, reflect that unit's contextual sense " +
                        "(a short multi-word gloss is fine when clearer than a single word).",
                    "definition: one to three sentences in the TARGET language. When a multi-word verbal unit applies, " +
                        "name the full expression as it appears in the context and explain its meaning here. " +
                        "Otherwise give a simple contextual gloss: what the word does in this sentence. " +
                        "Cap at about 80 words.",
                ).joinToString(" ")
            }

        val user =
            if (sentenceMode) {
                val passage = (if (word.isNotBlank()) word else context).take(12000)
                buildString {
                    appendLine("Target language for the translation: $targetLang")
                    appendLine("Passage to translate:")
                    append("\"\"\"")
                    append(passage)
                    append("\"\"\"")
                }
            } else {
                buildString {
                    appendLine("Target language for translation and any gloss: $targetLang")
                    append("Word or phrase (surface form): \"\"\"")
                    append(word)
                    appendLine("\"\"\"")
                    appendLine("Context (may be truncated):")
                    append("\"\"\"")
                    append(context)
                    append("\"\"\"")
                }
            }

        val body =
            JSONObject()
                .put("model", "gpt-4o-mini")
                .put("temperature", 0.2)
                .put("response_format", JSONObject().put("type", "json_object"))
                .put(
                    "messages",
                    JSONArray()
                        .put(JSONObject().put("role", "system").put("content", system))
                        .put(JSONObject().put("role", "user").put("content", user)),
                )

        val conn = (URL(API).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            setRequestProperty("Authorization", "Bearer $apiKey")
            setRequestProperty("Content-Type", "application/json; charset=utf-8")
            doOutput = true
            connectTimeout = 30_000
            readTimeout = 60_000
        }

        OutputStreamWriter(conn.outputStream, StandardCharsets.UTF_8).use { w ->
            w.write(body.toString())
        }

        val code = conn.responseCode
        val stream =
            if (code in 200..299) {
                conn.inputStream
            } else {
                conn.errorStream ?: conn.inputStream
            }
        val text =
            BufferedReader(InputStreamReader(stream, StandardCharsets.UTF_8)).use { it.readText() }
        if (code !in 200..299) {
            throw IllegalStateException("OpenAI $code: ${text.take(400)}")
        }

        val json = JSONObject(text)
        val content = json.getJSONArray("choices").getJSONObject(0).getJSONObject("message").getString("content")
        val parsed =
            try {
                JSONObject(content.trim())
            } catch (_: Exception) {
                val t = content.trim()
                val gloss = if (sentenceMode) JSONObject.NULL else glossOrFallback(word, t, null)
                return JSONObject().put("translation", t).put("definition", gloss)
            }
        val translation =
            when {
                parsed.has("translation") -> parsed.getString("translation")
                parsed.has("translated") -> parsed.getString("translated")
                else -> content.trim()
            }
        val definition =
            if (sentenceMode) {
                JSONObject.NULL
            } else {
                val raw =
                    if (parsed.isNull("definition")) {
                        null
                    } else {
                        parsed.get("definition")
                    }
                glossOrFallback(word, translation, raw)
            }
        return JSONObject().put("translation", translation).put("definition", definition)
    }

    /** Ensures word mode always returns a non-empty gloss string (never JSON null). */
    private fun glossOrFallback(word: String, translation: String, raw: Any?): String {
        val s =
            when (raw) {
                null, JSONObject.NULL -> ""
                is String -> raw.trim()
                else -> raw.toString().trim()
            }
        if (s.isNotEmpty() && !s.equals("null", ignoreCase = true) && !s.equals("undefined", ignoreCase = true)) {
            return s
        }
        val t = translation.trim()
        if (t.isNotEmpty()) {
            return t
        }
        val w = word.trim()
        return w.ifEmpty { "—" }
    }
}
