/** @typedef {{ translation: string, definition?: string | null }} TranslateResult */

importScripts("lookupMemory.js", "memorySync.js");

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
    // Bust cache when word-mode prompts / definition normalization change.
    pv: 4,
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
 * Word mode: never leave definition empty / literal "null" for clients that show it.
 * @param {string} word
 * @param {string} translation
 * @param {string | null | undefined} definition
 */
function normalizeWordDefinition(word, translation, definition) {
  let d = definition == null ? "" : String(definition).trim();
  if (!d || /^null$/i.test(d) || /^undefined$/i.test(d)) {
    const t = String(translation || "").trim();
    if (t) {
      return `No English gloss was returned; the translation line expresses the sense (${t}).`;
    }
    const w = String(word || "").trim();
    if (w) {
      return "No English gloss available for this token.";
    }
    return "No English gloss available.";
  }
  return d;
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
        'Schema: {"translation": string, "definition": string}.',
        "Both fields are required. translation must be in the user's requested target language. definition must always be written in clear English only (never the target language, never JSON null, never the literal text null, never an empty string).",
        "Detect whether the surface word belongs to a phrasal verb, separable verb, verb+particle idiom, or similar multi-word verbal expression in the context (particle may be adjacent or separated across words).",
        "translation: natural target-language equivalent for how the surface word reads in this sentence; if it participates in such a multi-word verbal unit, reflect that unit's contextual sense (a short multi-word gloss is fine when clearer than a single word).",
        "definition: English only. Match length to difficulty. For a plain word in a straightforward use, one tight phrase or a single short sentence (aim under ~22 words; no filler). When a multi-word verbal unit applies, or the sense is idiomatic, technical, or otherwise non-obvious, you may use up to two or three sentences (cap about 72 words). Name the full expression in context when explaining a phrasal or fixed collocation.",
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
        `Target language for the translation field only: ${payload.targetLang}`,
        "The definition field must be in English only, regardless of the page language.",
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
  if (message?.type === "NEO_BABYLON_MEMORY_GET") {
    (async () => {
      sendResponse({ ok: true, view: await getLookupMemoryView() });
    })();
    return true;
  }
  if (message?.type === "NEO_BABYLON_MEMORY_CLEAR") {
    (async () => {
      await clearLookupMemory();
      sendResponse({ ok: true });
    })();
    return true;
  }
  if (message?.type === "NEO_BABYLON_MEMORY_SYNC") {
    (async () => {
      await neoBabylonSyncMemoryNow();
      sendResponse({ ok: true });
    })();
    return true;
  }
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
      effectiveScope === "selection" ? false : includeDefinition !== false;

    const key = cacheKey(
      word,
      context,
      targetLang,
      effectiveIncludeDef,
      effectiveScope,
    );
    if (cache.has(key)) {
      const cached = cache.get(key);
      if (effectiveScope === "word" && cached) {
        await recordLookupMemory({
          word,
          translation: cached.translation,
          definition: cached.definition,
          scope: "word",
        });
        await neoBabylonSyncMemoryNow();
      }
      sendResponse({ ok: true, result: cached });
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
      // Word lookups always request a gloss from OpenAI/proxy; UI may hide it when the user turns definitions off.
      includeDefinition: effectiveScope === "word" ? true : false,
      scope: effectiveScope,
    };

    try {
      let result = proxyUrl
        ? await callProxy(proxyUrl, outbound)
        : await callOpenAI(apiKey, outbound);
      if (effectiveScope === "word") {
        result = {
          translation: result.translation,
          definition: normalizeWordDefinition(
            word,
            result.translation,
            result.definition,
          ),
        };
        if (!effectiveIncludeDef) {
          result = { ...result, definition: null };
        }
      }
      cacheSet(key, result);
      if (effectiveScope === "word") {
        await recordLookupMemory({
          word,
          translation: result.translation,
          definition: result.definition,
          scope: "word",
        });
        await neoBabylonSyncMemoryNow();
      }
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
const MEMORY_MENU_ID = "neobabylon-word-memory";

function openMemoryPage() {
  chrome.tabs.create({ url: chrome.runtime.getURL("memory.html") });
}

function registerContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: SELECTION_MENU_ID,
      title: "Translate selection with NeoBabylon",
      contexts: ["selection"],
    });
    chrome.contextMenus.create({
      id: MEMORY_MENU_ID,
      title: "NeoBabylon: Word memory (last 7 days)",
      contexts: ["page"],
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  registerContextMenus();
  neoBabylonSyncMemoryNow().catch(() => {});
});
registerContextMenus();

chrome.runtime.onStartup.addListener(() => {
  neoBabylonSyncMemoryNow().catch(() => {});
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (
    alarm.name === "neoBabylonMemorySync" ||
    alarm.name === "neoBabylonMemorySyncDebounce"
  ) {
    neoBabylonSyncMemoryNow().catch(() => {});
  }
});

chrome.alarms.create("neoBabylonMemorySync", { periodInMinutes: 5 });

chrome.action.onClicked.addListener(() => {
  openMemoryPage();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MEMORY_MENU_ID) {
    openMemoryPage();
    return;
  }
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
