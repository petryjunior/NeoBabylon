/**
 * Word lookup memory (last ~7 days). Loaded in the service worker via importScripts.
 */

const LOOKUP_MEMORY_KEY = "lookup_memory_json";
const LOOKUP_MEMORY_UPDATED_AT_KEY = "lookup_memory_updated_at";
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 800;

async function getLookupMemoryUpdatedAt() {
  const data = await chrome.storage.local.get(LOOKUP_MEMORY_UPDATED_AT_KEY);
  const ts = data[LOOKUP_MEMORY_UPDATED_AT_KEY];
  return typeof ts === "number" && Number.isFinite(ts) ? ts : 0;
}

async function setLookupMemoryUpdatedAt(ts) {
  await chrome.storage.local.set({ [LOOKUP_MEMORY_UPDATED_AT_KEY]: ts });
}

/** Replace local memory with a remote snapshot (used when remote updatedAt wins). */
async function applyLookupMemorySnapshot(entries, updatedAt) {
  const parsed = Array.isArray(entries)
    ? parseEntriesFromJson(JSON.stringify(entries))
    : [];
  await saveRawEntries(pruneEntries(parsed));
  await setLookupMemoryUpdatedAt(updatedAt);
}

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
  await setLookupMemoryUpdatedAt(now);
  if (typeof neoBabylonScheduleMemorySync === "function") {
    neoBabylonScheduleMemorySync();
  }
}

async function mergeRemoteLookupEntries(remoteEntries) {
  const imported = parseEntriesFromJson(JSON.stringify(remoteEntries));
  if (!imported.length) return 0;

  const existing = pruneEntries(await loadRawEntries());
  const byId = new Map();
  for (const e of existing) {
    if (e.id) byId.set(e.id, e);
  }

  let added = 0;
  for (const raw of imported) {
    const id =
      raw.id || `${raw.ts}_${Math.random().toString(36).slice(2, 9)}`;
    if (byId.has(id)) continue;
    byId.set(id, { ...raw, id, scope: "word" });
    added++;
  }

  const merged = [...byId.values()].sort((a, b) => b.ts - a.ts);
  await saveRawEntries(pruneEntries(merged));
  return added;
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
  const now = Date.now();
  await chrome.storage.local.remove(LOOKUP_MEMORY_KEY);
  await setLookupMemoryUpdatedAt(now);
  if (typeof neoBabylonSyncMemoryNow === "function") {
    await neoBabylonSyncMemoryNow();
  } else if (typeof neoBabylonScheduleMemorySync === "function") {
    neoBabylonScheduleMemorySync();
  }
}

function parseEntriesFromJson(json) {
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  const arr = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.entries)
      ? parsed.entries
      : [];
  return arr
    .map((raw) => ({
      id: String(raw?.id || "").trim(),
      word: String(raw?.word || "").trim(),
      translation: String(raw?.translation || "").trim(),
      definition:
        raw?.definition == null || raw?.definition === undefined
          ? null
          : String(raw.definition).trim() || null,
      ts: typeof raw?.ts === "number" ? raw.ts : 0,
      scope: raw?.scope === "word" ? "word" : "word",
    }))
    .filter((e) => e.word && e.translation && e.ts > 0);
}

