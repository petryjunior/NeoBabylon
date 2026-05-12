# NeoBabylon

Chrome extension (Manifest V3): **Alt+click** a word on a webpage to see a **contextual translation** via the OpenAI API (or your own proxy). Optional short definition/gloss in settings.

## Install (developer mode)

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this folder (`NeoBabylon`).
4. Open the extension’s **Options** (right-click the toolbar icon or use “Extension options”) and save your **OpenAI API key** (stored only in `chrome.storage.local` in this profile) or a **proxy URL** that forwards to OpenAI.

## Permissions

- **storage** — save settings and key locally.
- **http(s)://\*/\*** — inject the content script on web pages so Alt+click works while you browse.

For a public Chrome Web Store release, expect questions about broad host access; you can later narrow `matches` or add an onboarding toggle.

## Privacy

The selected word and a short surrounding text snippet are sent to OpenAI (or your proxy). Do not use on pages you are not allowed to send to a third party.

## Optional proxy

If `proxyUrl` is set in options, the background worker `POST`s JSON:

`{ "word", "context", "targetLang", "includeDefinition" }`

Your server should validate the user, attach the API key, call OpenAI, and return JSON like:

`{ "translation": "...", "definition": "..." }` (definition may be `null`).
