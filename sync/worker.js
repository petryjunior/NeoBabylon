/**
 * NeoBabylon word-memory sync (Cloudflare Worker + KV).
 * Auth: Bearer token = SHA-256 hex of the user's API key (derived on device; key never sent).
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function corsEmpty() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

function tokenFromRequest(request) {
  const auth = request.headers.get("Authorization") || "";
  const m = auth.match(/^Bearer\s+([a-f0-9]{64})$/i);
  return m ? m[1].toLowerCase() : null;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return corsEmpty();
    }

    const url = new URL(request.url);
    if (url.pathname !== "/v1/memory") {
      return json({ error: "not_found" }, 404);
    }

    const token = tokenFromRequest(request);
    if (!token) {
      return json({ error: "unauthorized" }, 401);
    }

    const kvKey = `mem:${token}`;

    if (request.method === "GET") {
      const raw = await env.MEMORY_KV.get(kvKey);
      if (!raw) {
        return json({ entries: [], updatedAt: 0 });
      }
      try {
        return json(JSON.parse(raw));
      } catch {
        return json({ entries: [], updatedAt: 0 });
      }
    }

    if (request.method === "PUT") {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "invalid_json" }, 400);
      }
      const entries = Array.isArray(body?.entries) ? body.entries : [];
      if (entries.length > 900) {
        return json({ error: "too_many_entries" }, 413);
      }
      const payload = {
        entries,
        updatedAt: typeof body.updatedAt === "number" ? body.updatedAt : Date.now(),
      };
      await env.MEMORY_KV.put(kvKey, JSON.stringify(payload), {
        expirationTtl: 60 * 60 * 24 * 8,
      });
      return json({ ok: true, updatedAt: payload.updatedAt });
    }

    return json({ error: "method_not_allowed" }, 405);
  },
};
