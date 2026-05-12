/** @typedef {{ translation: string, definition?: string | null }} TranslateResult */

const CACHE_MAX = 100;
/** @type {Map<string, TranslateResult>} */
const cache = new Map();

function cacheKey(word, context, targetLang, includeDefinition, scope) {
  return JSON.stringify({
    w: word,
    c: context.slice(0, 2000),
    t: targetLang,
    d: includeDefinition,
    s: scope || "word",
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
 * @param {{
 *   word: string,
 *   context: string,
 *   targetLang: string,
 *   includeDefinition: boolean,
 *   scope?: string,
 * }} payload
 */
async function callOpenAI(apiKey, payload) {
  const isSelection = payload.scope === "selection";
  const system = isSelection
    ? [
        "You translate text selections from web pages.",
        "The user highlighted a passage. Translate the ENTIRE passage into the requested target language.",
        "Preserve meaning and natural tone; do not return a word-by-word gloss unless the passage is a single word.",
        'Respond with JSON only: {"translation": string, "definition": null}.',
        'Always set "definition" to null.',
      ].join(" ")
    : [
        "You help users understand words on web pages.",
        "Given a surface word (possibly incomplete if hyphenated across lines—use context) and a short surrounding context, respond with JSON only.",
        'Schema: {"translation": string, "definition": string | null}.',
        "Detect whether the surface word belongs to a phrasal verb, separable verb, verb+particle idiom, or similar multi-word verbal expression in the context (particle may be adjacent or separated across words).",
        "translation: natural target-language equivalent for how the surface word reads in this sentence; if it participates in such a multi-word verbal unit, reflect that unit's contextual sense (a short multi-word gloss is fine when clearer than a single word).",
        "definition: always in the TARGET language.",
        payload.includeDefinition
          ? "When a multi-word verbal unit applies, the definition should name the full expression (as it appears in the context) and briefly explain its meaning here—not only the isolated surface word. Otherwise give a brief gloss when it adds clarity, or null. Cap at about 60 words."
          : 'Usually set "definition" to null. Exception: if a multi-word verbal unit applies as above, set definition to that concise phrasal explanation (name the full expression). If no such unit applies, null.',
      ].join(" ");

  const passage = payload.word.slice(0, 12000);
  const user = isSelection
    ? [
        `Target language for the translation: ${payload.targetLang}`,
        "Selected passage:",
        '"""',
        passage,
        '"""',
      ].join("\n")
    : [
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
 * @param {{
 *   word: string,
 *   context: string,
 *   targetLang: string,
 *   includeDefinition: boolean,
 *   scope?: string,
 * }} payload
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
    const {
      word,
      context,
      targetLang,
      includeDefinition,
      scope,
    } = message.payload;
    const effectiveScope = scope === "selection" ? "selection" : "word";
    const effectiveIncludeDef =
      effectiveScope === "selection" ? false : Boolean(includeDefinition);

    const key = cacheKey(
      word,
      context,
      targetLang,
      effectiveIncludeDef,
      effectiveScope,
    );
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

    const outbound = {
      word,
      context,
      targetLang,
      includeDefinition: effectiveIncludeDef,
      scope: effectiveScope,
    };

    try {
      const result = proxyUrl
        ? await callProxy(proxyUrl, outbound)
        : await callOpenAI(apiKey, outbound);
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

const SELECTION_MENU_ID = "neobabylon-translate-selection";

function registerContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: SELECTION_MENU_ID,
      title: "Translate selection with NeoBabylon",
      contexts: ["selection"],
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  registerContextMenus();
});
registerContextMenus();

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== SELECTION_MENU_ID) {
    return;
  }
  const tabId = tab?.id;
  if (tabId == null) {
    return;
  }
  const text = (info.selectionText || "").trim();
  if (!text) {
    return;
  }
  const sendOpts =
    typeof info.frameId === "number" && Number.isFinite(info.frameId)
      ? { frameId: info.frameId }
      : {};
  chrome.tabs
    .sendMessage(
      tabId,
      {
        type: "NEO_BABYLON_TRANSLATE_SELECTION",
        payload: { text },
      },
      sendOpts,
    )
    .catch(() => {});
});
