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
    if (
      ch === "\u00AD" ||
      ch === "\u200B" ||
      ch === "\u200C" ||
      ch === "\u200D" ||
      ch === "\uFEFF" ||
      ch === "\u2060"
    ) {
      return true;
    }
    return /\p{L}|\p{N}|\p{M}/u.test(ch);
  };

  const BLOCK_TAG = new Set([
    "ADDRESS",
    "ARTICLE",
    "ASIDE",
    "BLOCKQUOTE",
    "BODY",
    "CAPTION",
    "DD",
    "DETAILS",
    "DIV",
    "DL",
    "DT",
    "FIELDSET",
    "FIGCAPTION",
    "FIGURE",
    "FOOTER",
    "FORM",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "HEADER",
    "HR",
    "HTML",
    "LI",
    "MAIN",
    "NAV",
    "OL",
    "P",
    "PRE",
    "SECTION",
    "TABLE",
    "TBODY",
    "TD",
    "TFOOT",
    "TH",
    "THEAD",
    "TITLE",
    "TR",
    "UL",
  ]);

  /**
   * @param {Element | null} el
   */
  function isBlockElement(el) {
    return Boolean(el && el.nodeType === 1 && BLOCK_TAG.has(el.tagName));
  }

  /**
   * @param {Node} el
   * @returns {Text | null}
   */
  function lastTextInInlineSubtree(el) {
    if (el.nodeType === 3) return /** @type {Text} */ (el);
    if (el.nodeType !== 1 || isBlockElement(/** @type {Element} */ (el)))
      return null;
    for (let c = el.lastChild; c; c = c.previousSibling) {
      const t = lastTextInInlineSubtree(c);
      if (t) return t;
    }
    return null;
  }

  /**
   * @param {Node} el
   * @returns {Text | null}
   */
  function firstTextInInlineSubtree(el) {
    if (el.nodeType === 3) return /** @type {Text} */ (el);
    if (el.nodeType !== 1 || isBlockElement(/** @type {Element} */ (el)))
      return null;
    for (let c = el.firstChild; c; c = c.nextSibling) {
      const t = firstTextInInlineSubtree(c);
      if (t) return t;
    }
    return null;
  }

  /**
   * @param {Text} node
   * @returns {Text | null}
   */
  function prevInlineText(node) {
    let p = node.previousSibling;
    while (p) {
      if (p.nodeType === 3) return /** @type {Text} */ (p);
      if (p.nodeType === 1) {
        if (p.tagName === "BR") return null;
        if (p.tagName === "WBR") {
          p = p.previousSibling;
          continue;
        }
        if (!isBlockElement(/** @type {Element} */ (p))) {
          const t = lastTextInInlineSubtree(p);
          if (t) return t;
        } else {
          return null;
        }
      }
      p = p.previousSibling;
    }
    let el = node.parentElement;
    while (el && !isBlockElement(el)) {
      let s = el.previousSibling;
      while (s) {
        if (s.nodeType === 3) return /** @type {Text} */ (s);
        if (s.nodeType === 1) {
          if (s.tagName === "BR") return null;
          if (s.tagName === "WBR") {
            s = s.previousSibling;
            continue;
          }
          if (!isBlockElement(/** @type {Element} */ (s))) {
            const t = lastTextInInlineSubtree(s);
            if (t) return t;
          } else {
            return null;
          }
        }
        s = s.previousSibling;
      }
      el = el.parentElement;
    }
    return null;
  }

  /**
   * @param {Text} node
   * @returns {Text | null}
   */
  function nextInlineText(node) {
    let n = node.nextSibling;
    while (n) {
      if (n.nodeType === 3) return /** @type {Text} */ (n);
      if (n.nodeType === 1) {
        if (n.tagName === "BR") return null;
        if (n.tagName === "WBR") {
          n = n.nextSibling;
          continue;
        }
        if (!isBlockElement(/** @type {Element} */ (n))) {
          const t = firstTextInInlineSubtree(n);
          if (t) return t;
        } else {
          return null;
        }
      }
      n = n.nextSibling;
    }
    let el = node.parentElement;
    while (el && !isBlockElement(el)) {
      let s = el.nextSibling;
      while (s) {
        if (s.nodeType === 3) return /** @type {Text} */ (s);
        if (s.nodeType === 1) {
          if (s.tagName === "BR") return null;
          if (s.tagName === "WBR") {
            s = s.nextSibling;
            continue;
          }
          if (!isBlockElement(/** @type {Element} */ (s))) {
            const t = firstTextInInlineSubtree(s);
            if (t) return t;
          } else {
            return null;
          }
        }
        s = s.nextSibling;
      }
      el = el.parentElement;
    }
    return null;
  }

  /**
   * @param {Text} aNode
   * @param {Text} bNode
   */
  function textNodesGlue(aNode, bNode) {
    const a = aNode.data;
    const b = bNode.data;
    if (!a.length || !b.length) return false;
    const x = a[a.length - 1];
    const y = b[0];
    if (/\s/.test(x) || /\s/.test(y)) return false;
    return isWordChar(x) && isWordChar(y);
  }

  /**
   * @param {Text} textNode
   * @returns {Text[]}
   */
  function expandTextNodeChain(textNode) {
    const nodes = [textNode];
    let cur = textNode;
    for (let g = 0; g < 128; g++) {
      const p = prevInlineText(cur);
      if (!p || !textNodesGlue(p, cur)) break;
      nodes.unshift(p);
      cur = p;
    }
    cur = textNode;
    for (let g = 0; g < 128; g++) {
      const nxt = nextInlineText(cur);
      if (!nxt || !textNodesGlue(cur, nxt)) break;
      nodes.push(nxt);
      cur = nxt;
    }
    return nodes;
  }

  /**
   * @param {Text[]} nodes
   * @param {number} mergedIndex
   */
  function mapMergedIndexToNode(nodes, mergedIndex) {
    let i = 0;
    for (const n of nodes) {
      const len = n.data.length;
      if (mergedIndex < i + len) {
        return { node: n, offset: mergedIndex - i };
      }
      i += len;
    }
    const last = nodes[nodes.length - 1];
    return { node: last, offset: last.data.length };
  }

  /**
   * @param {string} text
   * @param {number} offset
   * @returns {{ start: number, end: number }}
   */
  function wordBoundsInTextFallback(text, offset) {
    let i = Math.min(offset, text.length);
    let start = i;
    while (start > 0 && isWordChar(text[start - 1])) start--;
    let end = i;
    while (end < text.length && isWordChar(text[end])) end++;
    return { start, end };
  }

  /**
   * @param {string} text
   * @param {number} offset
   * @returns {{ start: number, end: number } | null}
   */
  function segmenterWordBounds(text, offset) {
    if (typeof Intl.Segmenter !== "function" || !text.length) return null;
    try {
      const lang =
        document.documentElement.getAttribute("lang")?.trim() ||
        navigator.language ||
        "en";
      const seg = new Intl.Segmenter([lang, "de", "en"], { granularity: "word" });
      for (const part of seg.segment(text)) {
        if (part.isWordLike === false) continue;
        const idx = part.index;
        const endIdx = idx + part.segment.length;
        if (offset >= idx && offset < endIdx) {
          return { start: idx, end: endIdx };
        }
      }
    } catch (_) {}
    return null;
  }

  /**
   * @param {string} text
   * @param {number} offset
   */
  function wordBoundsInMerged(text, offset) {
    const fb = wordBoundsInTextFallback(text, offset);
    const sg = segmenterWordBounds(text, offset);
    const contains = (b, o) => o >= b.start && o < b.end;
    const okFb = contains(fb, offset);
    if (!sg || !contains(sg, offset)) return fb;
    if (!okFb) return sg;
    if (fb.end - fb.start >= sg.end - sg.start) return fb;
    return sg;
  }

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
    const chain = expandTextNodeChain(textNode);
    const merged = chain.map((n) => n.data).join("");
    let mergedOffset = startOffset;
    for (const n of chain) {
      if (n === textNode) break;
      mergedOffset += n.data.length;
    }
    const { start, end } = wordBoundsInMerged(merged, mergedOffset);
    const word = merged.slice(start, end);
    if (!word.trim()) {
      return null;
    }

    const block = textNode.parentElement?.closest(
      "p, li, td, th, blockquote, pre, article, section, main, h1, h2, h3, h4, h5, h6, body",
    );
    const holder = block || textNode.parentElement || document.body;
    const full = holder.textContent || "";
    const { node: startNode, offset: startInNode } = mapMergedIndexToNode(
      chain,
      start,
    );
    const wordStartInHolder = textOffsetInRoot(holder, startNode, startInNode);
    if (wordStartInHolder < 0) {
      const ctxStart = Math.max(0, start - CONTEXT_RADIUS);
      const ctxEnd = Math.min(merged.length, end + CONTEXT_RADIUS);
      return { word, context: merged.slice(ctxStart, ctxEnd) };
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
    const defText = result.definition ? String(result.definition).trim() : "";
    const def =
      defText &&
      !/^null$/i.test(defText) &&
      !/^undefined$/i.test(defText)
        ? `<div class="nb-def">${escapeHtml(defText)}</div>`
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
    includeDefinition: true,
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
              includeDefinition: stored.includeDefinition !== false,
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
