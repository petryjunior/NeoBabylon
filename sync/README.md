# Word memory cloud sync

OpenAI’s Files API **cannot download** `user_data` or `assistants` files, so NeoBabylon uses a tiny sync API instead.

- Same **OpenAI API key** on Chrome and Android → same private sync token (SHA-256 hash; the key is never sent).
- Endpoints: `GET` / `PUT` `https://<host>/v1/memory` with header `Authorization: Bearer <64-char-hex>`.

## Deploy once (maintainer)

**Option A — Deno Deploy (recommended)**

```bash
cd sync
deno deploy --project=neobabylon-memory deno-main.ts
```

Put the deployed URL (no trailing slash) in:

- `memorySync.js` → `DEFAULT_MEMORY_SYNC_BASE_URL`
- `MemorySync.kt` → `DEFAULT_SYNC_BASE_URL`

**Option B — Cloudflare Workers**

See `worker.js` and `wrangler.toml` (requires KV namespace + `wrangler deploy`).
