/**
 * NeoBabylon word-memory sync — deploy to Deno Deploy (free, includes KV).
 * deno deploy --project=neobabylon-memory sync/deno-main.ts
 */

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function tokenFromRequest(req: Request): string | null {
  const auth = req.headers.get("Authorization") || "";
  const m = auth.match(/^Bearer\s+([a-f0-9]{64})$/i);
  return m ? m[1].toLowerCase() : null;
}

const kv = await Deno.openKv();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  const url = new URL(req.url);
  if (url.pathname !== "/v1/memory") {
    return json({ error: "not_found" }, 404);
  }

  const token = tokenFromRequest(req);
  if (!token) {
    return json({ error: "unauthorized" }, 401);
  }

  const key = ["memory", token];

  if (req.method === "GET") {
    const ent = await kv.get(key);
    const val = ent.value as { entries?: unknown[]; updatedAt?: number } | null;
    return json(val ?? { entries: [], updatedAt: 0 });
  }

  if (req.method === "PUT") {
    let body: { entries?: unknown[]; updatedAt?: number };
    try {
      body = await req.json();
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
    await kv.set(key, payload);
    return json({ ok: true, updatedAt: payload.updatedAt });
  }

  return json({ error: "method_not_allowed" }, 405);
});
