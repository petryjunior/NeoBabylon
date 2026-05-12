(() => {
  const CONTEXT_RADIUS = 420;
  const HOST_ID = "neobabylon-host";
  const STALE_CONTEXT_MSG =
    "NeoBabylon was updated or reloaded. Refresh this page (F5) to keep translating.";

  /**
   * After chrome://extensions → Reload, old content scripts stay injected but
   * chrome.storage / sendMessage throw or set lastError.
   * @param {unknown} errOrMessage
   */
  function isStaleExtensionContext(errOrMessage) {
    const msg =
      typeof errOrMessage === "string"
        ? errOrMessage
        : errOrMessage instanceof Error
          ? errOrMessage.message
          : String(errOrMessage ?? "");
    return (
      /Extension context invalidated/i.test(msg) ||
      /Receiving end does not exist/i.test(msg) ||
      /message port closed before a response was received/i.test(msg)
    );
  }

  /**
   * @param {string | undefined} lastErrorMessage
   */
  function userFacingExtensionError(lastErrorMessage) {
    if (isStaleExtensionContext(lastErrorMessage || "")) {
      return STALE_CONTEXT_MSG;
    }
    return lastErrorMessage || "Extension error.";
  }

  /** @type {ShadowRoot | null} */
  let shadow = null;
  /** @type {HTMLElement | null} */
  let panelEl = null;

  const isWordChar = (ch) => {
    if (!ch) return false;
    if (ch === "'" || ch === "’" || ch === "-" || ch === "_") return true;
    return /\p{L}|\p{N}/u.test(ch);
  };

  /**
   * @param {number} x
   * @param {number} y
   * @returns {Range | null}
   */
  function rangeFromPoint(x, y) {
    if (document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(x, y);
      if (r) return r;
    }
    if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(x, y);
      if (pos && pos.offsetNode) {
        const r = document.createRange();
        try {
          r.setStart(pos.offsetNode, pos.offset);
          r.collapse(true);
          return r;
        } catch {
          return null;
        }
      }
    }
    return null;
  }

  /**
   * @param {Text} textNode
   * @param {number} offset
   * @returns {{ start: number, end: number }}
   */
  function wordBoundsInText(textNode, offset) {
    const text = textNode.data;
    let i = Math.min(offset, text.length);
    let start = i;
    while (start > 0 && isWordChar(text[start - 1])) start--;
    let end = i;
    while (end < text.length && isWordChar(text[end])) end++;
    return { start, end };
  }

  /**
   * @param {Node} root
   * @param {Text} targetText
   * @param {number} offsetInTarget
   * @returns {number}
   */
  function textOffsetInRoot(root, targetText, offsetInTarget) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let acc = 0;
    let n = walker.nextNode();
    while (n) {
      if (n === targetText) return acc + offsetInTarget;
      acc += n.textContent?.length ?? 0;
      n = walker.nextNode();
    }
    return -1;
  }

  /**
   * @param {Range} range
   * @returns {{ word: string, context: string } | null}
   */
  function wordAndContext(range) {
    const { startContainer, startOffset } = range;
    if (startContainer.nodeType !== Node.TEXT_NODE) {
      return null;
    }
    const textNode = /** @type {Text} */ (startContainer);
    const { start, end } = wordBoundsInText(textNode, startOffset);
    const word = textNode.data.slice(start, end);
    if (!word.trim()) {
      return null;
    }

    const block = textNode.parentElement?.closest(
      "p, li, td, th, blockquote, pre, article, section, main, h1, h2, h3, h4, h5, h6, body",
    );
    const holder = block || textNode.parentElement || document.body;
    const full = holder.textContent || "";
    const wordStartInHolder = textOffsetInRoot(holder, textNode, start);
    if (wordStartInHolder < 0) {
      const ctxStart = Math.max(0, start - CONTEXT_RADIUS);
      const ctxEnd = Math.min(textNode.data.length, end + CONTEXT_RADIUS);
      return { word, context: textNode.data.slice(ctxStart, ctxEnd) };
    }
    const from = Math.max(0, wordStartInHolder - CONTEXT_RADIUS);
    const to = Math.min(full.length, wordStartInHolder + word.length + CONTEXT_RADIUS);
    const context = full.slice(from, to).trim();
    return { word, context };
  }

  function ensureShadow() {
    let host = document.getElementById(HOST_ID);
    if (!host) {
      host = document.createElement("div");
      host.id = HOST_ID;
      host.setAttribute("data-neobabylon", "1");
      Object.assign(host.style, {
        all: "initial",
        position: "fixed",
        left: "0",
        top: "0",
        zIndex: "2147483646",
        pointerEvents: "none",
      });
      document.documentElement.appendChild(host);
      shadow = host.attachShadow({ mode: "closed" });
      const style = document.createElement("style");
      style.textContent = `
        :host { all: initial; }
        .nb-panel {
          pointer-events: auto;
          position: fixed;
          min-width: 12rem;
          max-width: min(22rem, calc(100vw - 24px));
          max-height: min(50vh, 320px);
          overflow: auto;
          padding: 10px 12px;
          border-radius: 10px;
          background: #111827;
          color: #f9fafb;
          font: 13px/1.45 system-ui, -apple-system, Segoe UI, sans-serif;
          box-shadow: 0 12px 40px rgba(0,0,0,0.35);
          border: 1px solid rgba(255,255,255,0.12);
        }
        .nb-word { font-weight: 650; margin-bottom: 6px; color: #93c5fd; }
        .nb-trans { margin-bottom: 6px; }
        .nb-def { font-size: 12px; opacity: 0.9; color: #e5e7eb; }
        .nb-err { color: #fecaca; }
        .nb-loading { opacity: 0.85; }
        .nb-close {
          position: absolute;
          top: 6px;
          right: 8px;
          background: transparent;
          border: none;
          color: #9ca3af;
          cursor: pointer;
          font-size: 16px;
          line-height: 1;
          padding: 4px;
        }
        .nb-close:hover { color: #fff; }
      `;
      shadow.appendChild(style);
    } else if (!shadow) {
      shadow = host.shadowRoot;
    }
    return shadow;
  }

  function removePanel() {
    panelEl?.remove();
    panelEl = null;
    disarmDismiss();
  }

  function placePanel(x, y) {
    if (!panelEl) return;
    const pad = 12;
    const rect = panelEl.getBoundingClientRect();
    let left = x + pad;
    let top = y + pad;
    if (left + rect.width > window.innerWidth - pad) {
      left = Math.max(pad, window.innerWidth - rect.width - pad);
    }
    if (top + rect.height > window.innerHeight - pad) {
      top = Math.max(pad, y - rect.height - pad);
    }
    panelEl.style.left = `${left}px`;
    panelEl.style.top = `${top}px`;
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {string} word
   */
  function showLoading(x, y, word) {
    const root = ensureShadow();
    removePanel();
    panelEl = document.createElement("div");
    panelEl.className = "nb-panel nb-loading";
    panelEl.setAttribute("role", "dialog");
    panelEl.setAttribute("aria-live", "polite");
    panelEl.setAttribute("aria-label", "Translation");
    panelEl.style.position = "fixed";
    panelEl.style.left = "0";
    panelEl.style.top = "0";
    panelEl.innerHTML = `<div class="nb-word"></div><div class="nb-trans">Translating…</div>`;
    const wEl = panelEl.querySelector(".nb-word");
    if (wEl) wEl.textContent = word;
    root?.appendChild(panelEl);
    placePanel(x, y);
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {string} word
   * @param {{ translation: string, definition?: string | null }} result
   */
  function showResult(x, y, word, result) {
    const root = ensureShadow();
    removePanel();
    panelEl = document.createElement("div");
    panelEl.className = "nb-panel";
    panelEl.setAttribute("role", "dialog");
    panelEl.setAttribute("aria-live", "polite");
    panelEl.setAttribute("aria-label", "Translation");
    panelEl.style.position = "fixed";
    const def =
      result.definition && result.definition.trim()
        ? `<div class="nb-def">${escapeHtml(result.definition.trim())}</div>`
        : "";
    panelEl.innerHTML = `
      <button type="button" class="nb-close" aria-label="Close">×</button>
      <div class="nb-word">${escapeHtml(word)}</div>
      <div class="nb-trans">${escapeHtml(result.translation)}</div>
      ${def}
    `;
    panelEl.querySelector(".nb-close")?.addEventListener("click", removePanel);
    root?.appendChild(panelEl);
    placePanel(x, y);
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {string} message
   */
  function showError(x, y, message) {
    const root = ensureShadow();
    removePanel();
    panelEl = document.createElement("div");
    panelEl.className = "nb-panel";
    panelEl.setAttribute("role", "alert");
    panelEl.setAttribute("aria-live", "assertive");
    panelEl.setAttribute("aria-label", "Translation error");
    panelEl.style.position = "fixed";
    panelEl.innerHTML = `
      <button type="button" class="nb-close" aria-label="Close">×</button>
      <div class="nb-err">${escapeHtml(message)}</div>
    `;
    panelEl.querySelector(".nb-close")?.addEventListener("click", removePanel);
    root?.appendChild(panelEl);
    placePanel(x, y);
  }

  function escapeHtml(s) {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /** @type {((e: MouseEvent) => void) | null} */
  let outsideHandler = null;

  function armDismiss() {
    disarmDismiss();
    outsideHandler = (e) => {
      const host = document.getElementById(HOST_ID);
      if (host?.shadowRoot && e.composedPath().includes(host)) return;
      removePanel();
    };
    window.addEventListener("click", outsideHandler, true);
  }

  function disarmDismiss() {
    if (outsideHandler) {
      window.removeEventListener("click", outsideHandler, true);
      outsideHandler = null;
    }
  }

  function truncateForHeader(text, max) {
    const m = max ?? 120;
    if (text.length <= m) return text;
    return text.slice(0, m - 1) + "…";
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {string} headerLabel
   * @param {{
   *   word: string,
   *   context: string,
   *   targetLang: string,
   *   includeDefinition: boolean,
   *   scope?: string,
   * }} payload
   */
  function sendTranslateAndShowPanel(x, y, headerLabel, payload) {
    chrome.runtime.sendMessage(
      { type: "NEO_BABYLON_TRANSLATE", payload },
      (response) => {
        if (chrome.runtime.lastError) {
          showError(
            x,
            y,
            userFacingExtensionError(chrome.runtime.lastError.message),
          );
          armDismiss();
          return;
        }
        if (!response?.ok) {
          showError(x, y, response?.error || "Unknown error.");
          armDismiss();
          return;
        }
        showResult(x, y, headerLabel, response.result);
        requestAnimationFrame(() => placePanel(x, y));
        armDismiss();
      },
    );
  }

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      removePanel();
      disarmDismiss();
    }
  });

  const STORAGE_KEYS = ["requireAlt", "targetLang", "includeDefinition"];

  /** Mirrors options; updated from storage so click handler stays synchronous. */
  let cachedUi = {
    requireAlt: true,
    targetLang: "English",
    includeDefinition: false,
  };

  function refreshCachedUi() {
    try {
      chrome.storage.local.get(STORAGE_KEYS, (r) => {
        if (chrome.runtime.lastError) {
          if (
            isStaleExtensionContext(chrome.runtime.lastError.message || "")
          ) {
            return;
          }
          return;
        }
        if (r && typeof r === "object") {
          cachedUi = { ...cachedUi, ...r };
        }
      });
    } catch (err) {
      if (!isStaleExtensionContext(err)) {
        console.error("[NeoBabylon] refreshCachedUi", err);
      }
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    for (const k of STORAGE_KEYS) {
      if (Object.prototype.hasOwnProperty.call(changes, k)) {
        cachedUi[k] = /** @type {any} */ (changes[k]).newValue;
      }
    }
  });

  refreshCachedUi();

  document.addEventListener(
    "click",
    (e) => {
      try {
        const requireAlt = cachedUi.requireAlt !== false;
        if (requireAlt && !e.altKey) return;

        const t = /** @type {HTMLElement} */ (e.target);
        if (t.closest(`#${HOST_ID}`)) return;
        if (t.closest("input, textarea, select, [contenteditable=true]")) {
          return;
        }

        const x = e.clientX;
        const y = e.clientY;
        const base = rangeFromPoint(x, y);
        if (!base) return;

        const extracted = wordAndContext(base);
        if (!extracted) return;

        e.preventDefault();
        e.stopPropagation();

        showLoading(x, y, extracted.word);

        void (async () => {
          try {
            let stored;
            try {
              stored = await chrome.storage.local.get(STORAGE_KEYS);
            } catch (err) {
              removePanel();
              if (isStaleExtensionContext(err)) {
                showError(x, y, STALE_CONTEXT_MSG);
                armDismiss();
                return;
              }
              throw err;
            }

            sendTranslateAndShowPanel(x, y, extracted.word, {
              word: extracted.word,
              context: extracted.context,
              targetLang: stored.targetLang || "English",
              includeDefinition: Boolean(stored.includeDefinition),
            });
          } catch (err) {
            removePanel();
            if (isStaleExtensionContext(err)) {
              showError(x, y, STALE_CONTEXT_MSG);
              armDismiss();
              return;
            }
            console.error("[NeoBabylon]", err);
            showError(
              x,
              y,
              err instanceof Error ? err.message : String(err),
            );
            armDismiss();
          }
        })();
      } catch (err) {
        if (isStaleExtensionContext(err)) {
          showError(e.clientX, e.clientY, STALE_CONTEXT_MSG);
          armDismiss();
          return;
        }
        console.error("[NeoBabylon]", err);
      }
    },
    true,
  );

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== "NEO_BABYLON_TRANSLATE_SELECTION") {
      return;
    }

    const text = String(msg.payload?.text || "").trim();
    if (!text) {
      sendResponse({ ok: false, error: "No selection text." });
      return;
    }

    const x = Math.min(
      Math.max(80, window.innerWidth / 2),
      window.innerWidth - 80,
    );
    const y = Math.min(
      Math.max(80, window.innerHeight * 0.28),
      window.innerHeight - 80,
    );

    const header = truncateForHeader(text, 140);
    showLoading(x, y, header);

    void (async () => {
      try {
        let stored;
        try {
          stored = await chrome.storage.local.get(STORAGE_KEYS);
        } catch (err) {
          removePanel();
          if (isStaleExtensionContext(err)) {
            showError(x, y, STALE_CONTEXT_MSG);
            armDismiss();
            return;
          }
          throw err;
        }

        sendTranslateAndShowPanel(x, y, header, {
          word: text,
          context: text,
          targetLang: stored.targetLang || "English",
          includeDefinition: false,
          scope: "selection",
        });
      } catch (err) {
        removePanel();
        if (isStaleExtensionContext(err)) {
          showError(x, y, STALE_CONTEXT_MSG);
          armDismiss();
          return;
        }
        console.error("[NeoBabylon]", err);
        showError(
          x,
          y,
          err instanceof Error ? err.message : String(err),
        );
        armDismiss();
      }
    })();

    sendResponse({ ok: true });
  });
})();
