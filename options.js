const LANGS = [
  { value: "English", label: "English" },
  { value: "Portuguese (Brazil)", label: "Portuguese (Brazil)" },
  { value: "Spanish", label: "Spanish" },
  { value: "French", label: "French" },
  { value: "German", label: "German" },
  { value: "Italian", label: "Italian" },
  { value: "Japanese", label: "Japanese" },
  { value: "Korean", label: "Korean" },
  { value: "Chinese (Simplified)", label: "Chinese (Simplified)" },
  { value: "Russian", label: "Russian" },
];

const KEYS = [
  "apiKey",
  "proxyUrl",
  "targetLang",
  "includeDefinition",
  "requireAlt",
];

function fillLangSelect() {
  const sel = document.getElementById("targetLang");
  if (!sel) return;
  sel.innerHTML = "";
  for (const { value, label } of LANGS) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    sel.appendChild(opt);
  }
}

async function load() {
  fillLangSelect();
  const data = await chrome.storage.local.get(KEYS);
  const apiKeyEl = document.getElementById("apiKey");
  const proxyEl = document.getElementById("proxyUrl");
  const langEl = document.getElementById("targetLang");
  const defEl = document.getElementById("includeDefinition");
  const altEl = document.getElementById("requireAlt");
  if (apiKeyEl) apiKeyEl.value = data.apiKey || "";
  if (proxyEl) proxyEl.value = data.proxyUrl || "";
  if (langEl) {
    const v = data.targetLang || "English";
    langEl.value = LANGS.some((l) => l.value === v) ? v : "English";
  }
  if (defEl) defEl.checked = data.includeDefinition !== false;
  if (altEl) altEl.checked = data.requireAlt !== false;
}

function setStatus(text, kind) {
  const el = document.getElementById("status");
  if (!el) return;
  el.textContent = text;
  el.className = kind || "";
}

document.getElementById("form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const apiKey = document.getElementById("apiKey")?.value.trim() ?? "";
  const proxyUrl = document.getElementById("proxyUrl")?.value.trim() ?? "";
  const targetLang =
    document.getElementById("targetLang")?.value || "English";
  const includeDefinition = Boolean(
    document.getElementById("includeDefinition")?.checked,
  );
  const requireAlt = Boolean(document.getElementById("requireAlt")?.checked);
  if (!proxyUrl && !apiKey) {
    setStatus("Enter an API key or a proxy URL.", "err");
    return;
  }

  await chrome.storage.local.set({
    apiKey,
    proxyUrl,
    targetLang,
    includeDefinition,
    requireAlt,
  });
  chrome.runtime.sendMessage({ type: "NEO_BABYLON_MEMORY_SYNC" }, () => {});
  setStatus(
    apiKey
      ? "Saved. Word memory syncs with the Android app when you use the same API key there."
      : "Saved.",
    "ok",
  );
});

load().catch((err) => {
  setStatus(err instanceof Error ? err.message : String(err), "err");
});
