/**
 * Sync word memory via OpenAI Assistants API (instructions field).
 * Same API key on Chrome + Android = same assistant = shared history.
 * OpenAI does not allow downloading Files API content for user_data/assistants.
 */

const ASSISTANTS_API = "https://api.openai.com/v1/assistants";
const ASSISTANTS_BETA = "assistants=v2";
const MEMORY_ASSISTANT_NAME = "NeoBabylon Word Memory";
const SYNC_DEBOUNCE_ALARM = "neoBabylonMemorySyncDebounce";

let memorySyncInFlight = null;

function normalizeApiKey(key) {
  return String(key || "")
    .replace(/\uFEFF/g, "")
    .trim();
}

async function resolveOpenAiKey() {
  const stored = await chrome.storage.local.get(["apiKey"]);
  return normalizeApiKey(stored.apiKey) || null;
}

function assistantHeaders(apiKey, extra = {}) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "OpenAI-Beta": ASSISTANTS_BETA,
    "Content-Type": "application/json",
    ...extra,
  };
}

function neoBabylonScheduleMemorySync() {
  chrome.alarms.clear(SYNC_DEBOUNCE_ALARM, () => {
    chrome.alarms.create(SYNC_DEBOUNCE_ALARM, { when: Date.now() + 800 });
  });
}

async function listAssistants(apiKey) {
  const res = await fetch(`${ASSISTANTS_API}?limit=100&order=desc`, {
    headers: assistantHeaders(apiKey),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI list assistants ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  return Array.isArray(data?.data) ? data.data : [];
}

async function findMemoryAssistant(apiKey) {
  const all = await listAssistants(apiKey);
  return (
    all.find(
      (a) =>
        a?.name === MEMORY_ASSISTANT_NAME ||
        a?.metadata?.neobabylon === "word_memory",
    ) || null
  );
}

function parseInstructionsPayload(text) {
  if (!text || !String(text).trim()) {
    return { entries: [], updatedAt: 0 };
  }
  try {
    const parsed = JSON.parse(String(text).trim());
    if (Array.isArray(parsed)) {
      return { entries: parsed, updatedAt: 0 };
    }
    if (parsed && typeof parsed === "object") {
      return {
        entries: Array.isArray(parsed.entries) ? parsed.entries : [],
        updatedAt:
          typeof parsed.updatedAt === "number" && Number.isFinite(parsed.updatedAt)
            ? parsed.updatedAt
            : 0,
      };
    }
  } catch {
    /* legacy or empty */
  }
  return { entries: [], updatedAt: 0 };
}

async function createMemoryAssistant(apiKey, payloadJson) {
  const res = await fetch(ASSISTANTS_API, {
    method: "POST",
    headers: assistantHeaders(apiKey),
    body: JSON.stringify({
      name: MEMORY_ASSISTANT_NAME,
      model: "gpt-4o-mini",
      instructions: payloadJson,
      tools: [],
      metadata: { neobabylon: "word_memory" },
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI create assistant ${res.status}: ${err.slice(0, 200)}`);
  }
  return res.json();
}

async function updateMemoryAssistant(apiKey, assistantId, payloadJson) {
  const res = await fetch(`${ASSISTANTS_API}/${assistantId}`, {
    method: "POST",
    headers: assistantHeaders(apiKey),
    body: JSON.stringify({ instructions: payloadJson }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI update assistant ${res.status}: ${err.slice(0, 200)}`);
  }
  return res.json();
}

async function setSyncStatus(patch) {
  const prev = await chrome.storage.local.get(["memorySyncStatus"]);
  await chrome.storage.local.set({
    memorySyncStatus: {
      ...(prev.memorySyncStatus || {}),
      ...patch,
      at: Date.now(),
    },
  });
}

async function neoBabylonSyncMemoryNow() {
  if (memorySyncInFlight) return memorySyncInFlight;

  memorySyncInFlight = (async () => {
    const apiKey = await resolveOpenAiKey();
    if (!apiKey) {
      await setSyncStatus({
        ok: false,
        error: "Add your OpenAI API key in settings to sync word memory.",
      });
      return;
    }

    try {
      let assistant = await findMemoryAssistant(apiKey);
      const localUpdatedAt = await getLookupMemoryUpdatedAt();

      if (assistant?.instructions) {
        const remote = parseInstructionsPayload(assistant.instructions);
        if (remote.updatedAt > localUpdatedAt) {
          await applyLookupMemorySnapshot(remote.entries, remote.updatedAt);
        } else if (remote.updatedAt < localUpdatedAt) {
          /* Local clear or newer edits win; do not merge stale remote. */
        } else if (remote.entries.length) {
          await mergeRemoteLookupEntries(remote.entries);
        }
      }

      const entries = pruneEntries(await loadRawEntries());
      const payloadUpdatedAt = Math.max(
        await getLookupMemoryUpdatedAt(),
        Date.now(),
      );
      await setLookupMemoryUpdatedAt(payloadUpdatedAt);
      const payload = JSON.stringify({ entries, updatedAt: payloadUpdatedAt });

      if (assistant?.id) {
        await updateMemoryAssistant(apiKey, assistant.id, payload);
      } else {
        await createMemoryAssistant(apiKey, payload);
      }

      await setSyncStatus({ ok: true, error: null, entryCount: entries.length });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("NeoBabylon memory sync:", msg);
      await setSyncStatus({ ok: false, error: msg });
    }
  })();

  try {
    await memorySyncInFlight;
  } finally {
    memorySyncInFlight = null;
  }
}
