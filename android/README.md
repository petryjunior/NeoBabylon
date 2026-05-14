# NeoBabylon for Android (solo WebView)

This is **not** a Chrome extension. It is a tiny **WebView browser** you install yourself. You browse inside this app; on **long-press** (press and hold a word until the context menu would appear), NeoBabylon **captures the `contextmenu` event**, resolves the word + local context, calls **OpenAI from Kotlin** (your key stays in Android `SharedPreferences`, not in page JavaScript), and shows the same style of overlay as the desktop extension.

## Tradeoffs (read once)

- **You use this app instead of Chrome** for pages where you want tap-and-hold translate. Normal Chrome is unchanged.
- **Strict Content-Security-Policy sites** may block `eval` used to inject the script; most news / wiki sites work. If a page fails, there is no fallback inside stock Chrome.
- **`JavascriptInterface`** is exposed to every page loaded in the WebView. Your **API key is not passed to JS**, but a malicious page could spam `translateAsync` and spend your quota. Solo browsing only.

## Build

1. Install [Android Studio](https://developer.android.com/studio) on Windows or Linux.
2. **Open** the `android` folder (not the repo root) as a project.
3. Let Gradle sync; use **JDK 17**.
4. Run **Run > Run 'app'** on a device or emulator (Android 8+).

If the app **closes immediately on open**, plug in USB with debugging on, then in a PC terminal run  
`"%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe" logcat -d | findstr AndroidRuntime`  
and look for the **FATAL EXCEPTION** stack trace (often a layout/theme issue on first launch).

First launch: open the **⋮** menu (right of the **Go** arrow) → **API key & language**, save your key. Use the **refresh** icon or **pull down** on the page to reload. Tap the address bar to see **site roots** you’ve opened (history stores `https://host/` only, not every path); the **clear** (×) icon appears as soon as the field is focused or non-empty. **Go** loads the page. **Long-press a word** (or hold ~½ second) to translate; each word lookup asks the model for a **short definition in English** (on by default; you can turn off **Show English definition** to hide that row). The **translation** uses your chosen target language. After a word translation, tap **Full sentence** to translate **one sentence** around the word (the app scans the **whole block** text—e.g. a Wikipedia `<p>`—for `. ? !` and citation brackets, not only the small context clip); **Back to word** returns to the word view. The close control is HTML `&#215;` plus UTF-8-safe injection so it is not garbled.

## How it maps to desktop

| Desktop (Chrome extension) | Android (this app)        |
|-----------------------------|---------------------------|
| Alt+click                   | Long-press word (`contextmenu`) |
| `chrome.storage`            | `SharedPreferences`       |
| Background service worker   | Kotlin `HttpURLConnection` |

The Chrome extension remains the primary experience on desktop; this folder is an optional **personal mobile** companion.
