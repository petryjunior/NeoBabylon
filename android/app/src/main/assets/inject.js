(function () {
  if (window.__neobabylonInjected) {
    return;
  }
  window.__neobabylonInjected = true;

  const CONTEXT_RADIUS = 420;
  const HOST_ID = "neobabylon-host";

  let shadow = null;
  let panelEl = null;

  const isWordChar = (ch) => {
    if (!ch) return false;
    if (ch === "'" || ch === "\u2019" || ch === "-" || ch === "_") return true;
    return /\p{L}|\p{N}/u.test(ch);
  };

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

  function wordBoundsInText(textNode, offset) {
    const text = textNode.data;
    let i = Math.min(offset, text.length);
    let start = i;
    while (start > 0 && isWordChar(text[start - 1])) start--;
    let end = i;
    while (end < text.length && isWordChar(text[end])) end++;
    return { start, end };
  }

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

  function wordAndContext(range) {
    const { startContainer, startOffset } = range;
    if (startContainer.nodeType !== Node.TEXT_NODE) {
      return null;
    }
    const textNode = startContainer;
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
    const to = Math.min(
      full.length,
      wordStartInHolder + word.length + CONTEXT_RADIUS,
    );
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
        .nb-actions { margin-top: 10px; display: flex; flex-direction: column; gap: 8px; }
        .nb-rowbtn {
          align-self: stretch;
          padding: 8px 10px;
          border-radius: 8px;
          border: 1px solid rgba(255,255,255,0.28);
          background: rgba(255,255,255,0.08);
          color: #e5e7eb;
          font: inherit;
          cursor: pointer;
        }
        .nb-rowbtn:active { background: rgba(255,255,255,0.16); }
      `;
      shadow.appendChild(style);
    } else if (!shadow) {
      shadow = host.shadowRoot;
    }
    return shadow;
  }

  let outsideHandler = null;

  function disarmDismiss() {
    if (outsideHandler) {
      window.removeEventListener("click", outsideHandler, true);
      outsideHandler = null;
    }
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

  function escapeHtml(s) {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function showLoading(x, y, label) {
    const root = ensureShadow();
    removePanel();
    panelEl = document.createElement("div");
    panelEl.className = "nb-panel nb-loading";
    panelEl.style.position = "fixed";
    panelEl.style.left = "0";
    panelEl.style.top = "0";
    panelEl.innerHTML = `<div class="nb-word"></div><div class="nb-trans">Translating...</div>`;
    const wEl = panelEl.querySelector(".nb-word");
    if (wEl) wEl.textContent = label;
    root?.appendChild(panelEl);
    placePanel(x, y);
  }

  let lastWordPanel = null;

  function showResult(x, y, headerLabel, result, contextSnippet) {
    lastWordPanel = { x, y, headerLabel, result, context: contextSnippet };
    const root = ensureShadow();
    removePanel();
    panelEl = document.createElement("div");
    panelEl.className = "nb-panel";
    panelEl.style.position = "fixed";
    const def =
      result.definition && String(result.definition).trim()
        ? `<div class="nb-def">${escapeHtml(String(result.definition).trim())}</div>`
        : "";
    const canSentence =
      contextSnippet &&
      contextSnippet.trim().length > headerLabel.trim().length + 2;
    const sentenceBtn = canSentence
      ? '<button type="button" class="nb-rowbtn nb-fullsent">Full sentence</button>'
      : "";
    panelEl.innerHTML = `
      <button type="button" class="nb-close" aria-label="Close">&#215;</button>
      <div class="nb-word">${escapeHtml(headerLabel)}</div>
      <div class="nb-trans">${escapeHtml(result.translation)}</div>
      ${def}
      <div class="nb-actions">${sentenceBtn}</div>
    `;
    panelEl.querySelector(".nb-close")?.addEventListener("click", removePanel);
    const fs = panelEl.querySelector(".nb-fullsent");
    if (fs) {
      fs.addEventListener("click", (ev) => {
        ev.stopPropagation();
        runSentenceTranslate(x, y, contextSnippet.trim());
      });
    }
    root?.appendChild(panelEl);
    placePanel(x, y);
  }

  function runSentenceTranslate(x, y, passage) {
    showLoading(x, y, "Sentence...");
    const cbId = "_neo_" + Date.now() + "_" + Math.floor(Math.random() * 1e9);
    window[cbId] = function (resp) {
      delete window[cbId];
      if (!resp || !resp.ok) {
        showError(x, y, (resp && resp.error) || "Unknown error.");
        armDismiss();
        return;
      }
      showSentenceResult(x, y, resp.result.translation);
      armDismiss();
    };
    try {
      NeoAndroid.translateAsync(
        JSON.stringify({
          word: passage,
          context: passage,
          sentenceMode: true,
        }),
        cbId,
      );
    } catch (err) {
      showError(x, y, err && err.message ? err.message : String(err));
      armDismiss();
    }
  }

  function showSentenceResult(x, y, translationText) {
    const lp = lastWordPanel;
    const root = ensureShadow();
    removePanel();
    panelEl = document.createElement("div");
    panelEl.className = "nb-panel";
    panelEl.style.position = "fixed";
    const backBtn =
      lp && lp.result
        ? '<button type="button" class="nb-rowbtn nb-backword">Back to word</button>'
        : "";
    panelEl.innerHTML = `
      <button type="button" class="nb-close" aria-label="Close">&#215;</button>
      <div class="nb-word">Full sentence</div>
      <div class="nb-trans">${escapeHtml(translationText)}</div>
      <div class="nb-actions">${backBtn}</div>
    `;
    panelEl.querySelector(".nb-close")?.addEventListener("click", removePanel);
    const bk = panelEl.querySelector(".nb-backword");
    if (bk && lp) {
      bk.addEventListener("click", (ev) => {
        ev.stopPropagation();
        showResult(lp.x, lp.y, lp.headerLabel, lp.result, lp.context);
        armDismiss();
      });
    }
    root?.appendChild(panelEl);
    placePanel(x, y);
  }

  function showError(x, y, message) {
    const root = ensureShadow();
    removePanel();
    panelEl = document.createElement("div");
    panelEl.className = "nb-panel";
    panelEl.style.position = "fixed";
    panelEl.innerHTML = `
      <button type="button" class="nb-close" aria-label="Close">&#215;</button>
      <div class="nb-err">${escapeHtml(message)}</div>
    `;
    panelEl.querySelector(".nb-close")?.addEventListener("click", removePanel);
    root?.appendChild(panelEl);
    placePanel(x, y);
  }

  function armDismiss() {
    disarmDismiss();
    outsideHandler = (e) => {
      const host = document.getElementById(HOST_ID);
      if (host?.shadowRoot && e.composedPath().includes(host)) return;
      removePanel();
    };
    window.addEventListener("click", outsideHandler, true);
  }

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      removePanel();
      disarmDismiss();
    }
  });

  let longPressTimer = null;
  const touchStart = { x: 0, y: 0 };
  let lastTranslateAt = 0;

  function ignoreInteractive(el) {
    return (
      el &&
      el.closest &&
      (el.closest(`#${HOST_ID}`) ||
        el.closest("input, textarea, select, [contenteditable=true]"))
    );
  }

  function beginTranslate(x, y, extracted, ev) {
    if (ev && typeof ev.preventDefault === "function") {
      ev.preventDefault();
      ev.stopPropagation();
    }
    showLoading(x, y, extracted.word);

    const cbId = "_neo_" + Date.now() + "_" + Math.floor(Math.random() * 1e9);
    window[cbId] = function (resp) {
      delete window[cbId];
      try {
        if (!resp || !resp.ok) {
          showError(x, y, (resp && resp.error) || "Unknown error.");
          armDismiss();
          return;
        }
        showResult(x, y, extracted.word, resp.result, extracted.context);
        requestAnimationFrame(() => placePanel(x, y));
        armDismiss();
      } catch (err) {
        showError(x, y, err && err.message ? err.message : String(err));
        armDismiss();
      }
    };

    try {
      NeoAndroid.translateAsync(
        JSON.stringify({
          word: extracted.word,
          context: extracted.context,
        }),
        cbId,
      );
    } catch (err) {
      showError(x, y, err && err.message ? err.message : String(err));
      armDismiss();
    }
  }

  function tryBeginFromPoint(x, y, ev) {
    if (Date.now() - lastTranslateAt < 600) {
      return false;
    }
    const probe = document.elementFromPoint(x, y);
    if (ignoreInteractive(probe)) {
      return false;
    }
    const base = rangeFromPoint(x, y);
    if (!base) {
      return false;
    }
    const extracted = wordAndContext(base);
    if (!extracted) {
      return false;
    }
    lastTranslateAt = Date.now();
    beginTranslate(x, y, extracted, ev);
    return true;
  }

  document.addEventListener(
    "contextmenu",
    (e) => {
      if (ignoreInteractive(e.target)) {
        return;
      }
      tryBeginFromPoint(e.clientX, e.clientY, e);
    },
    true,
  );

  document.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length !== 1) {
        return;
      }
      if (ignoreInteractive(e.target)) {
        return;
      }
      const t = e.touches[0];
      touchStart.x = t.clientX;
      touchStart.y = t.clientY;
      if (longPressTimer) {
        clearTimeout(longPressTimer);
      }
      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        tryBeginFromPoint(touchStart.x, touchStart.y, null);
      }, 520);
    },
    { passive: true },
  );

  document.addEventListener(
    "touchmove",
    (e) => {
      if (!longPressTimer || e.touches.length !== 1) {
        return;
      }
      const t = e.touches[0];
      const dx = t.clientX - touchStart.x;
      const dy = t.clientY - touchStart.y;
      if (dx * dx + dy * dy > 14 * 14) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    },
    { passive: true },
  );

  document.addEventListener(
    "touchend",
    () => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    },
    { passive: true },
  );
})();
