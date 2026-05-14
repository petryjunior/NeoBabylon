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
                    "You translate exactly one sentence from a web page.",
                    "The user tapped a word; the client sends a short clip that should be a single sentence containing that word.",
                    "Translate only that sentence into the requested target language. Do not merge or translate extra sentences if any slipped through.",
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
                    "Both fields are required. translation must be in the user's requested target language. " +
                        "definition must always be written in clear English only (never the target language, " +
                        """never JSON null, never the literal text "null", never an empty string).""",
                    multiword,
                    "translation: natural target-language equivalent for how the surface word reads in this sentence; " +
                        "if it participates in such a multi-word verbal unit, reflect that unit's contextual sense " +
                        "(a short multi-word gloss is fine when clearer than a single word).",
                    "definition: English only. Match length to difficulty. " +
                        "For a plain word in a straightforward use, one tight phrase or a single short sentence (aim under ~22 words; no filler). " +
                        "When a multi-word verbal unit applies, or the sense is idiomatic, technical, or otherwise non-obvious, you may use up to two or three sentences (cap about 72 words). " +
                        "Name the full expression in context when explaining a phrasal or fixed collocation.",
                ).joinToString(" ")
            }

        val user =
            if (sentenceMode) {
                val passage = (if (word.isNotBlank()) word else context).take(12000)
                buildString {
                    appendLine("Target language for the translation: $targetLang")
                    appendLine("Single sentence to translate (contains the tapped word):")
                    append("\"\"\"")
                    append(passage)
                    append("\"\"\"")
                }
            } else {
                buildString {
                    appendLine("Target language for the translation field only: $targetLang")
                    appendLine("The definition field must be in English only, regardless of source language.")
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
            return "No English gloss was returned; the translation line expresses the sense ($t)."
        }
        val w = word.trim()
        if (w.isNotEmpty()) {
            return "No English gloss available for this token."
        }
        return "No English gloss available."
    }
}
