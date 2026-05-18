function formatWhen(ts) {
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderEntry(entry) {
  let html = '<div class="entry">';
  html += '<div class="meta">' + escapeHtml(formatWhen(entry.ts)) + "</div>";
  html += '<div class="trans">' + escapeHtml(entry.translation) + "</div>";
  if (entry.definition && String(entry.definition).trim()) {
    html +=
      '<div class="def">' + escapeHtml(String(entry.definition).trim()) + "</div>";
  }
  html += "</div>";
  return html;
}

function renderRepeatedGroup(group) {
  let html = '<article class="card">';
  html += '<div class="word">' + escapeHtml(group.word) + "</div>";
  html += '<div class="meta">Looked up ' + group.count + " times</div>";
  for (const e of group.entries) {
    html += renderEntry(e);
  }
  html += "</article>";
  return html;
}

function renderTimelineEntry(entry) {
  let html = '<article class="card">';
  html += '<div class="word">' + escapeHtml(entry.word) + "</div>";
  html += '<div class="meta">' + escapeHtml(formatWhen(entry.ts)) + "</div>";
  html += '<div class="trans">' + escapeHtml(entry.translation) + "</div>";
  if (entry.definition && String(entry.definition).trim()) {
    html +=
      '<div class="def">' + escapeHtml(String(entry.definition).trim()) + "</div>";
  }
  html += "</article>";
  return html;
}

function renderView(view) {
  const parts = [];
  if (view.repeated?.length) {
    parts.push("<section><h2>Looked up again</h2>");
    for (const g of view.repeated) {
      parts.push(renderRepeatedGroup(g));
    }
    parts.push("</section>");
  }
  if (view.timeline?.length) {
    parts.push("<section><h2>All lookups (newest first)</h2>");
    for (const e of view.timeline) {
      parts.push(renderTimelineEntry(e));
    }
    parts.push("</section>");
  }
  return parts.join("");
}

function load() {
  const loading = document.getElementById("loading");
  const content = document.getElementById("content");
  const empty = document.getElementById("empty");

  chrome.storage.local.get(["memorySyncStatus"], (stored) => {
    const st = stored.memorySyncStatus;
    const el = document.getElementById("syncStatus");
    if (el && st) {
      if (st.ok) {
        el.textContent = "Cloud sync OK.";
        el.style.color = "#15803d";
      } else if (st.error) {
        el.textContent = "Cloud sync issue: " + st.error;
        el.style.color = "#b91c1c";
      }
    }
  });

  chrome.runtime.sendMessage({ type: "NEO_BABYLON_MEMORY_SYNC" }, () => {
    chrome.runtime.sendMessage({ type: "NEO_BABYLON_MEMORY_GET" }, (resp) => {
      loading.hidden = true;
      if (chrome.runtime.lastError || !resp?.ok) {
        empty.hidden = false;
        empty.textContent = "Could not load memory.";
        return;
      }
      const view = resp.view;
      if (!view.timeline?.length) {
        empty.hidden = false;
        return;
      }
      content.innerHTML = renderView(view);
      content.hidden = false;
      chrome.storage.local.get(["memorySyncStatus"], (stored) => {
        const st = stored.memorySyncStatus;
        const el = document.getElementById("syncStatus");
        if (!el || !st) return;
        if (st.ok) {
          el.textContent = "Cloud sync OK.";
          el.style.color = "#15803d";
        } else if (st.error) {
          el.textContent = "Cloud sync issue: " + st.error;
          el.style.color = "#b91c1c";
        }
      });
    });
  });
}

document.getElementById("clearBtn")?.addEventListener("click", () => {
  if (!confirm("Clear all word memory from the last 7 days?")) return;
  chrome.runtime.sendMessage({ type: "NEO_BABYLON_MEMORY_CLEAR" }, () => {
    document.getElementById("content").hidden = true;
    document.getElementById("content").innerHTML = "";
    document.getElementById("empty").hidden = false;
    document.getElementById("empty").textContent =
      "Memory cleared. Alt+click words to build a new history.";
  });
});

load();
