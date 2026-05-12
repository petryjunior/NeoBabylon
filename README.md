# NeoBabylon

Chrome extension (Manifest V3): **Alt+click** a word for a contextual translation, or **right-click selected text** and choose **Translate selection with NeoBabylon** (OpenAI). Word mode asks the model for a **short definition in English** every time (contextual gloss, with extra emphasis on **phrasal verbs** when relevant), while the **translation** uses your chosen target language. In **Options**, you can turn off **Show definition** to hide that line in the popup (the API still returns a gloss so the cache stays consistent).

For **Android (solo)**, see the WebView app in [`android/README.md`](android/README.md): use the **API key & language** button, then the address bar; **long-press** a word to translate similarly to desktop.

## Install (developer mode)

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this folder (`NeoBabylon`).
4. Open the extension’s **Options** (right-click the toolbar icon or use “Extension options”) and save your **OpenAI API key** (stored only in `chrome.storage.local` in this profile) or a **proxy URL** that forwards to OpenAI.

After you click **Reload** on the extension (or load a new build), **refresh any open tabs** where you use NeoBabylon. Otherwise Chrome can keep an old content script and you may see “Extension context invalidated” until the page is reloaded.

## Permissions

- **storage** — save settings and key locally.
- **contextMenus** — add “Translate selection with NeoBabylon” to the right-click menu when text is selected.
- **http(s)://\*/\*** — inject the content script on web pages so Alt+click works while you browse.

For a public Chrome Web Store release, expect questions about broad host access; you can later narrow `matches` or add an onboarding toggle.

## Chrome Web Store checklist (when you publish)

- Host justification: explain that the content script must run on pages where the user Alt-clicks text.
- Privacy policy URL: disclose that word + snippet are sent to OpenAI (or your proxy) and that the API key is stored locally (or that auth goes through your backend).
- Single purpose: contextual translation on demand.

## Privacy

The selected word and a short surrounding text snippet are sent to OpenAI (or your proxy). Do not use on pages you are not allowed to send to a third party.

## Optional proxy

If `proxyUrl` is set in options, the background worker `POST`s JSON:

`{ "word", "context", "targetLang", "includeDefinition", "scope" }`

`scope` is `"word"` (default) or `"selection"` for full-passage translation from the context menu. For **word** scope, `includeDefinition` in the POST body is always `true` so your backend should request a non-empty `definition` string from the model (see `background.js`); the extension may hide that field in the UI when the user disables definitions.

Your server should validate the user, attach the API key, call OpenAI, and return JSON like:

`{ "translation": "...", "definition": "..." }` (`definition` must be **English** for word mode—short for simple words, longer only when phrasal or genuinely tricky; `translation` is in the target language. The client normalizes empty or literal `"null"` responses).

Use the same **word-mode** system prompt behavior as `background.js` (English gloss + phrasal-verb handling, target language for translation only).
