/**
 * Word lookup memory (last ~7 days). Loaded in the service worker via importScripts.
 */

const LOOKUP_MEMORY_KEY = "lookup_memory_json";
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 800;

function normalizeWordKey(word) {
  return word.trim().toLowerCase();
}

async function loadRawEntries() {
  const data = await chrome.storage.local.get(LOOKUP_MEMORY_KEY);
  const raw = data[LOOKUP_MEMORY_KEY];
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function saveRawEntries(entries) {
  await chrome.storage.local.set({
    [LOOKUP_MEMORY_KEY]: JSON.stringify(entries),
  });
}

function pruneEntries(entries, now = Date.now()) {
  const cutoff = now - RETENTION_MS;
  return entries
    .filter((e) => typeof e.ts === "number" && e.ts >= cutoff)
    .slice(0, MAX_ENTRIES);
}

async function recordLookupMemory(params) {
  const scope = params.scope || "word";
  if (scope !== "word") return;

  const word = String(params.word || "").trim();
  const translation = String(params.translation || "").trim();
  if (!word || !translation) return;

  const definition =
    params.definition == null || params.definition === undefined
      ? null
      : String(params.definition).trim() || null;

  const now = Date.now();
  let entries = pruneEntries(await loadRawEntries(), now);
  entries.unshift({
    id: `${now}_${Math.random().toString(36).slice(2, 9)}`,
    word,
    translation,
    definition,
    ts: now,
    scope: "word",
  });
  if (entries.length > MAX_ENTRIES) {
    entries = entries.slice(0, MAX_ENTRIES);
  }
  await saveRawEntries(entries);
}

async function getLookupMemoryView() {
  const entries = pruneEntries(await loadRawEntries());
  await saveRawEntries(entries);

  const byKey = new Map();
  for (const e of entries) {
    const key = normalizeWordKey(e.word);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(e);
  }

  const repeated = [];
  for (const [, list] of byKey) {
    if (list.length < 2) continue;
    list.sort((a, b) => b.ts - a.ts);
    repeated.push({
      word: list[0].word,
      count: list.length,
      entries: list,
    });
  }
  repeated.sort((a, b) => b.count - a.count || b.entries[0].ts - a.entries[0].ts);

  const timeline = [...entries].sort((a, b) => b.ts - a.ts);

  return { repeated, timeline };
}

async function clearLookupMemory() {
  await chrome.storage.local.remove(LOOKUP_MEMORY_KEY);
}
