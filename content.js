(() => {
  const CONTEXT_RADIUS = 420;
  const HOST_ID = "neobabylon-host";

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

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      removePanel();
      disarmDismiss();
    }
  });

  document.addEventListener(
    "click",
    async (e) => {
      const stored = await chrome.storage.local.get([
        "requireAlt",
        "targetLang",
        "includeDefinition",
      ]);
      const requireAlt = stored.requireAlt !== false;
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

      chrome.runtime.sendMessage(
        {
          type: "NEO_BABYLON_TRANSLATE",
          payload: {
            word: extracted.word,
            context: extracted.context,
            targetLang: stored.targetLang || "English",
            includeDefinition: Boolean(stored.includeDefinition),
          },
        },
        (response) => {
          if (chrome.runtime.lastError) {
            showError(
              x,
              y,
              chrome.runtime.lastError.message || "Extension error.",
            );
            armDismiss();
            return;
          }
          if (!response?.ok) {
            showError(x, y, response?.error || "Unknown error.");
            armDismiss();
            return;
          }
          showResult(x, y, extracted.word, response.result);
          requestAnimationFrame(() => placePanel(x, y));
          armDismiss();
        },
      );
    },
    true,
  );
})();
