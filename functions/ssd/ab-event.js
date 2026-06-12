/**
 * POST /ssd/ab-event  — records one A/B event.
 * Body: {v:"a"|"b", e:"view"|"cta:<name>", t:<ms>}
 *
 * Storage: AB_EVENTS_KV namespace binding (set in Cloudflare Pages dashboard).
 * Counters are stored as plain integers under keys: ab:<variant>:<event>
 * If the binding is absent, the endpoint 204s silently (fail-safe, like the
 * Stripe webhook's in-memory fallback) so the site never errors.
 */

const ALLOWED_EVENTS = /^(view|cta:[a-z0-9_-]{1,32})$/;

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json();
    const v = body.v === "a" || body.v === "b" ? body.v : null;
    const e = typeof body.e === "string" && ALLOWED_EVENTS.test(body.e) ? body.e : null;
    if (!v || !e) return new Response(null, { status: 204 });

    const kv = env.AB_EVENTS_KV;
    if (!kv) return new Response(null, { status: 204 }); // no binding yet -> no-op

    const key = `ab:${v}:${e}`;
    const cur = parseInt((await kv.get(key)) || "0", 10);
    await kv.put(key, String(cur + 1));
    // also track a daily bucket so we can see momentum
    const day = new Date().toISOString().slice(0, 10);
    const dkey = `ab:${day}:${v}:${e}`;
    const dcur = parseInt((await kv.get(dkey)) || "0", 10);
    await kv.put(dkey, String(dcur + 1), { expirationTtl: 60 * 60 * 24 * 120 });

    return new Response(null, { status: 204 });
  } catch (_) {
    return new Response(null, { status: 204 });
  }
}

// Cheap CORS preflight / health
export async function onRequestGet() {
  return new Response("ok", { status: 200 });
}
