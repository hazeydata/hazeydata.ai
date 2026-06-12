/**
 * GET /ssd/ab-results  — live A/B scoreboard (JSON).
 * Computes per-variant exposures, conversions, conversion rate, lift,
 * and a two-proportion z-test so you know when the result is trustworthy.
 *
 * Optional ?key=<ADMIN_KEY> gate if env.AB_ADMIN_KEY is set.
 * "conversion" = any cta:* click (primary signal: cta:api = Get API Access).
 */

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (env.AB_ADMIN_KEY && url.searchParams.get("key") !== env.AB_ADMIN_KEY) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const kv = env.AB_EVENTS_KV;
  if (!kv) {
    return Response.json({ error: "AB_EVENTS_KV not bound — set it in the Pages dashboard." }, { status: 200 });
  }

  const list = await kv.list({ prefix: "ab:" });
  const totals = { a: { view: 0, cta: {} }, b: { view: 0, cta: {} } };
  for (const k of list.keys) {
    const parts = k.name.split(":"); // ab:<v>:<event...>  OR ab:<day>:<v>:<event>
    if (parts.length < 3) continue;
    if (parts[1] !== "a" && parts[1] !== "b") continue; // skip daily buckets here
    const v = parts[1];
    const val = parseInt((await kv.get(k.name)) || "0", 10);
    if (parts[2] === "view") totals[v].view += val;
    else if (parts[2] === "cta") totals[v].cta[parts[3] || "?"] = (totals[v].cta[parts[3] || "?"] || 0) + val;
  }

  const score = (t) => {
    const conv = Object.values(t.cta).reduce((s, n) => s + n, 0);
    return { exposures: t.view, conversions: conv, rate: t.view ? conv / t.view : 0, cta: t.cta };
  };
  const A = score(totals.a), B = score(totals.b);

  // Two-proportion z-test
  const n1 = A.exposures, n2 = B.exposures, x1 = A.conversions, x2 = B.conversions;
  let z = 0, p = 1, significant = false, leader = null;
  if (n1 > 0 && n2 > 0) {
    const p1 = x1 / n1, p2 = x2 / n2;
    const pp = (x1 + x2) / (n1 + n2);
    const se = Math.sqrt(pp * (1 - pp) * (1 / n1 + 1 / n2));
    if (se > 0) {
      z = (p1 - p2) / se;
      p = 2 * (1 - normCdf(Math.abs(z)));
      significant = p < 0.05;
      leader = p1 === p2 ? null : p1 > p2 ? "a" : "b";
    }
  }
  const lift = A.rate > 0 ? (B.rate - A.rate) / A.rate : null;

  return Response.json({
    updated: new Date().toISOString(),
    variants: {
      a: { name: "Editorial", ...A, rate_pct: +(A.rate * 100).toFixed(2) },
      b: { name: "Data Terminal", ...B, rate_pct: +(B.rate * 100).toFixed(2) },
    },
    comparison: {
      leader,
      b_vs_a_lift_pct: lift === null ? null : +(lift * 100).toFixed(1),
      z: +z.toFixed(3),
      p_value: +p.toFixed(4),
      significant,
      verdict: !significant
        ? "Keep running — not enough data for a confident call yet."
        : `Variant ${leader.toUpperCase()} wins (p=${p.toFixed(4)}).`,
    },
  }, { headers: { "cache-control": "no-store" } });
}

// Abramowitz & Stegun normal CDF approximation
function normCdf(x) {
  const t = 1 / (1 + 0.2316419 * x);
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return 1 - prob;
}
