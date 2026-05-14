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
    // Invisible / discretionary breaks inside one printed word (German compounds, hyphenation).
    if (
      ch === "\u00AD" || // soft hyphen
      ch === "\u200B" || // zero-width space
      ch === "\u200C" || // ZWNJ
      ch === "\u200D" || // ZWJ
      ch === "\uFEFF" || // BOM / ZWNBSP as used in some exports
      ch === "\u2060"
    ) {
      // word joiner
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

  function isBlockElement(el) {
    return Boolean(el && el.nodeType === 1 && BLOCK_TAG.has(el.tagName));
  }

  function lastTextInInlineSubtree(el) {
    if (el.nodeType === 3) return el;
    if (el.nodeType !== 1 || isBlockElement(el)) return null;
    for (let c = el.lastChild; c; c = c.previousSibling) {
      const t = lastTextInInlineSubtree(c);
      if (t) return t;
    }
    return null;
  }

  function firstTextInInlineSubtree(el) {
    if (el.nodeType === 3) return el;
    if (el.nodeType !== 1 || isBlockElement(el)) return null;
    for (let c = el.firstChild; c; c = c.nextSibling) {
      const t = firstTextInInlineSubtree(c);
      if (t) return t;
    }
    return null;
  }

  function prevInlineText(node) {
    if (node.nodeType !== 3) return null;
    let p = node.previousSibling;
    while (p) {
      if (p.nodeType === 3) return p;
      if (p.nodeType === 1) {
        if (p.tagName === "BR") return null;
        if (p.tagName === "WBR") {
          p = p.previousSibling;
          continue;
        }
        if (!isBlockElement(p)) {
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
        if (s.nodeType === 3) return s;
        if (s.nodeType === 1) {
          if (s.tagName === "BR") return null;
          if (s.tagName === "WBR") {
            s = s.previousSibling;
            continue;
          }
          if (!isBlockElement(s)) {
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

  function nextInlineText(node) {
    if (node.nodeType !== 3) return null;
    let n = node.nextSibling;
    while (n) {
      if (n.nodeType === 3) return n;
      if (n.nodeType === 1) {
        if (n.tagName === "BR") return null;
        if (n.tagName === "WBR") {
          n = n.nextSibling;
          continue;
        }
        if (!isBlockElement(n)) {
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
        if (s.nodeType === 3) return s;
        if (s.nodeType === 1) {
          if (s.tagName === "BR") return null;
          if (s.tagName === "WBR") {
            s = s.nextSibling;
            continue;
          }
          if (!isBlockElement(s)) {
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

  function textNodesGlue(aNode, bNode) {
    const a = aNode.data;
    const b = bNode.data;
    if (!a.length || !b.length) return false;
    const x = a[a.length - 1];
    const y = b[0];
    if (/\s/.test(x) || /\s/.test(y)) return false;
    return isWordChar(x) && isWordChar(y);
  }

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

  function wordBoundsInTextFallback(text, offset) {
    let i = Math.min(offset, text.length);
    let start = i;
    while (start > 0 && isWordChar(text[start - 1])) start--;
    let end = i;
    while (end < text.length && isWordChar(text[end])) end++;
    return { start, end };
  }

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

  function wordBoundsInMerged(text, offset) {
    const fb = wordBoundsInTextFallback(text, offset);
    const sg = segmenterWordBounds(text, offset);
    const contains = (b, o) => o >= b.start && o < b.end;
    const okFb = contains(fb, offset);
    if (!sg || !contains(sg, offset)) return fb;
    if (!okFb) return sg;
    // Intl segmenter often splits German compounds at ZWSP/SHY; prefer the wider run.
    if (fb.end - fb.start >= sg.end - sg.start) return fb;
    return sg;
  }

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
      const clip = merged.slice(ctxStart, ctxEnd);
      return {
        word,
        context: clip,
        sentencePassage: extractSingleSentencePassage(clip, word),
      };
    }
    const from = Math.max(0, wordStartInHolder - CONTEXT_RADIUS);
    const to = Math.min(
      full.length,
      wordStartInHolder + word.length + CONTEXT_RADIUS,
    );
    const context = full.slice(from, to).trim();
    const { text: sentSlice, idx: sentIdx } = sliceForSentenceExtraction(
      full,
      wordStartInHolder,
    );
    const sentencePassage = extractSentenceAtIndex(
      sentSlice,
      sentIdx,
      word.length,
      word,
    );
    return { word, context, sentencePassage };
  }

  const MAX_SENTENCE_CHARS = 520;

  function findBestWordIndex(ctx, word) {
    const w = word.trim();
    if (!w) return 0;
    const lowerCtx = ctx.toLowerCase();
    const lowerW = w.toLowerCase();
    let best = -1;
    let bestDist = Infinity;
    let pos = 0;
    while (pos <= ctx.length) {
      const i = lowerCtx.indexOf(lowerW, pos);
      if (i < 0) break;
      const d = Math.abs(i + w.length / 2 - ctx.length / 2);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
      pos = i + 1;
    }
    return best >= 0 ? best : Math.floor(ctx.length / 2);
  }

  function collapseWs(s) {
    return s.replace(/\s+/g, " ").trim();
  }

  function sentenceViaIntlSegmenter(ctx, wordIdx) {
    if (typeof Intl.Segmenter !== "function") return null;
    try {
      const lang =
        document.documentElement.getAttribute("lang")?.trim() ||
        navigator.language ||
        "en";
      const seg = new Intl.Segmenter([lang, "de", "en"], {
        granularity: "sentence",
      });
      for (const part of seg.segment(ctx)) {
        const a = part.index;
        const b = a + part.segment.length;
        if (wordIdx >= a && wordIdx < b) {
          const t = collapseWs(part.segment);
          if (t.length > 0 && t.length <= MAX_SENTENCE_CHARS) {
            return t;
          }
        }
      }
    } catch (_) {}
    return null;
  }

  function isLikelySentenceEnd(ctx, i) {
    const ch = ctx[i];
    if (ch === "\n") return true;
    if (ch === "\u2026" || ch === "\u0964") return true;
    if (ch === "!" || ch === "?" || ch === ";") return true;
    if (ch === ".") {
      const prev = i > 0 ? ctx[i - 1] : "";
      const next = i + 1 < ctx.length ? ctx[i + 1] : "";
      if (/\d/.test(prev) && /\d/.test(next)) return false;
      return true;
    }
    return false;
  }

  function consumeSpacesQuotes(ctx, j) {
    while (j < ctx.length && /[\s"'\u00bb\u00ab)\]]/.test(ctx[j])) j++;
    return j;
  }

  function consumeWikiRefBracket(ctx, j) {
    if (j >= ctx.length || ctx[j] !== "[") return j;
    j++;
    while (j < ctx.length && ctx[j] !== "]") j++;
    if (j < ctx.length && ctx[j] === "]") j++;
    return j;
  }

  function sentenceViaPunctuation(ctx, wordIdx, wordLen) {
    if (wordIdx < 0) return collapseWs(ctx);
    let start = 0;
    for (let i = wordIdx - 1; i >= 0; i--) {
      const ch = ctx[i];
      if (ch === "\n") {
        start = i + 1;
        break;
      }
      if (isLikelySentenceEnd(ctx, i)) {
        let j = i + 1;
        j = consumeSpacesQuotes(ctx, j);
        j = consumeWikiRefBracket(ctx, j);
        start = j;
        break;
      }
    }
    let end = ctx.length;
    for (let i = wordIdx + wordLen; i < ctx.length; i++) {
      const ch = ctx[i];
      if (ch === "\n") {
        end = i;
        break;
      }
      if (isLikelySentenceEnd(ctx, i)) {
        end = i + 1;
        let j = end;
        j = consumeSpacesQuotes(ctx, j);
        j = consumeWikiRefBracket(ctx, j);
        end = j;
        break;
      }
    }
    return collapseWs(ctx.slice(start, end));
  }

  function clampPassageAroundWord(passage, word) {
    if (passage.length <= MAX_SENTENCE_CHARS) return passage;
    const idx = findBestWordIndex(passage, word);
    if (idx < 0) return passage.slice(0, MAX_SENTENCE_CHARS).trim();
    const center = idx + Math.floor(word.trim().length / 2);
    let lo = Math.max(0, center - Math.floor(MAX_SENTENCE_CHARS / 2));
    let hi = Math.min(passage.length, lo + MAX_SENTENCE_CHARS);
    if (hi - lo < MAX_SENTENCE_CHARS) {
      lo = Math.max(0, hi - MAX_SENTENCE_CHARS);
    }
    while (lo > 0 && passage[lo] !== " ") lo--;
    if (lo > 0) lo++;
    while (hi < passage.length && passage[hi] !== " ") hi++;
    return collapseWs(passage.slice(lo, hi));
  }

  /**
   * Narrow a wide context clip to roughly one sentence containing [word].
   */
  function extractSingleSentencePassage(ctxRaw, word) {
    const ctx = ctxRaw.replace(/\r\n/g, "\n").trim();
    if (!ctx) return ctx;
    const idx = findBestWordIndex(ctx, word);
    let out = sentenceViaIntlSegmenter(ctx, idx);
    if (!out) {
      out = sentenceViaPunctuation(ctx, idx, word.trim().length);
    }
    out = clampPassageAroundWord(out, word);
    return out || ctx;
  }

  /** Limit work for Intl / scans on huge DOM blocks (e.g. section/article). */
  function sliceForSentenceExtraction(full, wordIdx) {
    const max = 4000;
    if (full.length <= max) {
      return { text: full, idx: wordIdx };
    }
    const half = Math.floor(max / 2);
    let from = Math.max(0, wordIdx - half);
    let to = Math.min(full.length, from + max);
    if (to - from < max) {
      from = Math.max(0, to - max);
    }
    return { text: full.slice(from, to), idx: wordIdx - from };
  }

  /**
   * Sentence containing the word using its index in block text (full Wikipedia <p>, etc.).
   */
  function extractSentenceAtIndex(fullRaw, wordIdx, wordLen, word) {
    const { text, idx } = sliceForSentenceExtraction(fullRaw, wordIdx);
    const len = Math.min(Math.max(wordLen, 1), text.length - idx);
    let out = sentenceViaIntlSegmenter(text, idx);
    if (!out) {
      out = sentenceViaPunctuation(text, idx, len);
    }
    out = clampPassageAroundWord(out, word);
    return out || collapseWs(text.slice(idx, Math.min(text.length, idx + 400)));
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

  function showResult(x, y, headerLabel, result, contextSnippet, sentencePassageOpt) {
    const opt =
      sentencePassageOpt != null ? String(sentencePassageOpt).trim() : "";
    const sentencePassage = (
      opt
        ? opt
        : extractSingleSentencePassage(
            String(contextSnippet || "").trim(),
            headerLabel.trim(),
          )
    ).trim();
    lastWordPanel = {
      x,
      y,
      headerLabel,
      result,
      context: contextSnippet,
      sentencePassage,
    };
    const root = ensureShadow();
    removePanel();
    panelEl = document.createElement("div");
    panelEl.className = "nb-panel";
    panelEl.style.position = "fixed";
    const def =
      result.definition &&
      String(result.definition).trim() &&
      !/^null$/i.test(String(result.definition).trim()) &&
      !/^undefined$/i.test(String(result.definition).trim())
        ? `<div class="nb-def">${escapeHtml(String(result.definition).trim())}</div>`
        : "";
    const canSentence =
      sentencePassage && sentencePassage.length > headerLabel.trim().length + 2;
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
        runSentenceTranslate(x, y, sentencePassage);
      });
    }
    root?.appendChild(panelEl);
    placePanel(x, y);
  }

  function runSentenceTranslate(x, y, passage) {
    const trimmed = String(passage || "").trim();
    if (!trimmed) {
      return;
    }
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
          word: trimmed,
          context: trimmed,
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
        showResult(lp.x, lp.y, lp.headerLabel, lp.result, lp.context, lp.sentencePassage);
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
        showResult(x, y, extracted.word, resp.result, extracted.context, extracted.sentencePassage);
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
