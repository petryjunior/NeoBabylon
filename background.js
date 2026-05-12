/** @typedef {{ translation: string, definition?: string | null }} TranslateResult */

const CACHE_MAX = 100;
/** @type {Map<string, TranslateResult>} */
const cache = new Map();

function cacheKey(word, context, targetLang, includeDefinition) {
  return JSON.stringify({
    w: word,
    c: context.slice(0, 2000),
    t: targetLang,
    d: includeDefinition,
  });
}

function cacheSet(key, value) {
  if (cache.size >= CACHE_MAX) {
    const first = cache.keys().next().value;
    cache.delete(first);
  }
  cache.set(key, value);
}

/**
 * @param {string} body
 * @returns {TranslateResult}
 */
function parseJsonReply(body) {
  const trimmed = body.trim();
  let data;
  try {
    data = JSON.parse(trimmed);
  } catch {
    return { translation: trimmed, definition: null };
  }
  const translation =
    typeof data.translation === "string"
      ? data.translation
      : typeof data.translated === "string"
        ? data.translated
        : JSON.stringify(data);
  const definition =
    data.definition === undefined || data.definition === null
      ? null
      : String(data.definition);
  return { translation, definition };
}

/**
 * @param {string} apiKey
 * @param {{ word: string, context: string, targetLang: string, includeDefinition: boolean }} payload
 */
async function callOpenAI(apiKey, payload) {
  const system = [
    "You help users understand words on web pages.",
    "Given a surface word (possibly incomplete if hyphenated across lines—use context) and a short surrounding context, respond with JSON only.",
    'Schema: {"translation": string, "definition": string | null}.',
    "translation: natural translation of that word or phrase in the given target language, matching how it is used in context.",
    "definition: brief gloss in the TARGET language if useful for a human reader; otherwise null.",
    payload.includeDefinition
      ? "Include definition when it adds clarity; keep it under 40 words."
      : 'Always set "definition" to null.',
  ].join(" ");

  const user = [
    `Target language for translation and any gloss: ${payload.targetLang}`,
    `Word or phrase (surface form): """${payload.word}"""`,
    "Context (may be truncated):",
    '"""',
    payload.context,
    '"""',
  ].join("\n");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI ${res.status}: ${errText.slice(0, 400)}`);
  }

  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("Unexpected OpenAI response shape.");
  }
  return parseJsonReply(content);
}

/**
 * @param {string} proxyUrl
 * @param {{ word: string, context: string, targetLang: string, includeDefinition: boolean }} payload
 */
async function callProxy(proxyUrl, payload) {
  const res = await fetch(proxyUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Proxy ${res.status}: ${errText.slice(0, 400)}`);
  }
  const text = await res.text();
  return parseJsonReply(text);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "NEO_BABYLON_TRANSLATE") {
    return;
  }

  (async () => {
    const { word, context, targetLang, includeDefinition } = message.payload;
    const key = cacheKey(word, context, targetLang, includeDefinition);
    if (cache.has(key)) {
      sendResponse({ ok: true, result: cache.get(key) });
      return;
    }

    const stored = await chrome.storage.local.get([
      "apiKey",
      "proxyUrl",
    ]);
    const apiKey = (stored.apiKey || "").trim();
    const proxyUrl = (stored.proxyUrl || "").trim();

    if (!proxyUrl && !apiKey) {
      sendResponse({
        ok: false,
        error: "Configure your OpenAI API key or proxy in NeoBabylon options.",
      });
      return;
    }

    try {
      const result = proxyUrl
        ? await callProxy(proxyUrl, {
            word,
            context,
            targetLang,
            includeDefinition,
          })
        : await callOpenAI(apiKey, {
            word,
            context,
            targetLang,
            includeDefinition,
          });
      cacheSet(key, result);
      sendResponse({ ok: true, result });
    } catch (e) {
      sendResponse({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  })();

  return true;
});
