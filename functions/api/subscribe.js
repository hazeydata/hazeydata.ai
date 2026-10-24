// HD-SIGNUP-001 (R2 store-first): POST /api/subscribe -> D1 SIGNUPS, then best-effort Beehiiv v2 forward.
import {
  SOURCES, ALLOWED_ORIGINS, RATE_LIMIT, BEEHIIV_TIMEOUT_MS, STATUSES,
} from '../../assets/signup/signup-config.js';

const HTTP = { subscribed: 200, already_subscribed: 200, invalid_email: 400, rate_limited: 429, error: 502 };
// Pragmatic server-side check (AC3). The browser's type=email is not trusted.
const EMAIL_RE = /^[^\s@"<>()\[\],;:\\]{1,64}@(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;
const UTM_RE = /^[A-Za-z0-9._-]{1,100}$/;

const memoryBuckets = new Map(); // fallback only when no SIGNUP_RL binding (local dev)

export function isValidEmail(email) {
  return typeof email === 'string' && email.length <= 254 && EMAIL_RE.test(email);
}

export function normalizeSource(raw) {
  return SOURCES.includes(raw) ? raw : 'unknown';
}

function log(status, source, beehiivStatus, reason) {
  // AC10: status, source, Beehiiv HTTP status and a fixed failure reason only.
  console.log(JSON.stringify({ evt: 'signup', status, source, beehiiv_status: beehiivStatus ?? null, reason: reason ?? null }));
}

async function ipKey(ip, windowStart) {
  const data = new TextEncoder().encode(`hd-signup:${ip}`);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const hex = [...new Uint8Array(hash)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `rl:${windowStart}:${hex}`;
}

// AC7: fixed window, 5 per IP per 10 min. Storage: KV namespace bound as SIGNUP_RL (key = window +
// truncated SHA-256 of the IP, TTL just over the window; no raw IP stored). KV is eventually consistent,
// so the limit is approximate across edge locations. Without the binding it falls back to per-isolate memory.
// A KV error fails open: the store write that follows decides the outcome.
export async function overLimit(env, ip, nowMs = Date.now()) {
  const windowStart = Math.floor(nowMs / 1000 / RATE_LIMIT.windowSeconds) * RATE_LIMIT.windowSeconds;
  const key = await ipKey(ip || 'none', windowStart);
  const kv = env.SIGNUP_RL;
  let count;
  if (kv) {
    try {
      count = (parseInt(await kv.get(key), 10) || 0) + 1;
      await kv.put(key, String(count), { expirationTtl: RATE_LIMIT.windowSeconds + 60 });
    } catch { return false; }
  } else {
    count = (memoryBuckets.get(key) || 0) + 1;
    memoryBuckets.set(key, count);
  }
  return count > RATE_LIMIT.max;
}

export function _resetMemoryLimiter() { memoryBuckets.clear(); }

function wantsJson(request) {
  return (request.headers.get('Accept') || '').includes('application/json');
}

function redirectTarget(request) {
  const ref = request.headers.get('Referer');
  try {
    const u = new URL(ref);
    if (ALLOWED_ORIGINS.includes(u.origin)) return u;
  } catch { /* fall through */ }
  return new URL('/', ALLOWED_ORIGINS[0]);
}

function respond(request, status, extra = {}) {
  if (!STATUSES.includes(status)) status = 'error';
  if (wantsJson(request)) {
    return new Response(JSON.stringify({ status, ...extra }), {
      status: HTTP[status],
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
  const u = redirectTarget(request);
  u.searchParams.set('signup', status);
  u.hash = 'signup';
  return new Response(null, { status: 303, headers: { Location: u.toString(), 'Cache-Control': 'no-store' } });
}

async function callBeehiiv(env, body, fetchImpl, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(
      `https://api.beehiiv.com/v2/publications/${encodeURIComponent(env.BEEHIIV_PUB_ID)}/subscriptions`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.BEEHIIV_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      },
    );
    try { await res.body?.cancel(); } catch { /* ignore */ }
    return { httpStatus: res.status };
  } catch {
    return { httpStatus: null }; // timeout or network failure
  } finally {
    clearTimeout(timer);
  }
}

export async function handleSubscribe(request, env, opts = {}) {
  const fetchImpl = opts.fetch || fetch;
  const timeoutMs = opts.timeoutMs ?? BEEHIIV_TIMEOUT_MS;
  const now = opts.now ?? Date.now();

  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
  }
  const origin = request.headers.get('Origin');
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) {
    log('forbidden_origin', null, null);
    return new Response('Forbidden', { status: 403 });
  }

  let form;
  try { form = await request.formData(); } catch { form = new FormData(); }
  const source = normalizeSource(String(form.get('source') || ''));

  const ip = request.headers.get('CF-Connecting-IP') || '';
  if (await overLimit(env, ip, now)) { log('rate_limited', source, null); return respond(request, 'rate_limited'); }

  if (String(form.get('website') || '') !== '') { log('honeypot', source, null); return respond(request, 'subscribed'); }

  const email = String(form.get('email') || '').trim().toLowerCase();
  if (!isValidEmail(email)) { log('invalid_email', source, null); return respond(request, 'invalid_email'); }

  const utm = {};
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign']) {
    const v = String(form.get(k) || '');
    utm[k] = UTM_RE.test(v) ? v : null;
  }

  // AC21/AC24/AC25: store first. Unique email (lowercased) dedupes; a write failure is the only 502.
  const db = env.SIGNUPS;
  let inserted;
  if (!db) { log('error', source, null, 'no_binding'); return respond(request, 'error'); }
  try {
    const r = await db.prepare(
      `INSERT INTO signups (email, source, utm_source, utm_medium, utm_campaign, created_at, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending') ON CONFLICT(email) DO NOTHING`,
    ).bind(email, source, utm.utm_source, utm.utm_medium, utm.utm_campaign, new Date(now).toISOString()).run();
    inserted = (r?.meta?.changes ?? 0) > 0;
  } catch {
    log('error', source, null, 'store_error');
    return respond(request, 'error');
  }
  if (!inserted) { log('already_subscribed', source, null); return respond(request, 'already_subscribed'); }

  // AC22/AC23: best-effort forward. The visitor sees success whatever Beehiiv does.
  let httpStatus = null;
  if (env.BEEHIIV_API_KEY && env.BEEHIIV_PUB_ID) {
    const body = { email, utm_source: source, reactivate_existing: false, send_welcome_email: false };
    if (utm.utm_medium) body.utm_medium = utm.utm_medium;
    if (utm.utm_campaign) body.utm_campaign = utm.utm_campaign;
    if (utm.utm_source) body.utm_content = utm.utm_source; // R1: incoming utm_source -> utm_content
    const ref = request.headers.get('Referer');
    if (ref) { try { const r = new URL(ref); if (ALLOWED_ORIGINS.includes(r.origin)) body.referring_site = r.origin + r.pathname; } catch { /* ignore */ } }
    ({ httpStatus } = await callBeehiiv(env, body, fetchImpl, timeoutMs));
  }
  const forwarded = httpStatus !== null && httpStatus >= 200 && httpStatus < 300;
  try {
    if (forwarded) {
      await db.prepare("UPDATE signups SET status = 'forwarded', forwarded_at = ?, last_error_code = NULL WHERE email = ?")
        .bind(new Date(now).toISOString(), email).run();
    } else {
      await db.prepare('UPDATE signups SET last_error_code = ? WHERE email = ?').bind(httpStatus, email).run();
    }
  } catch { /* row is stored as pending already; export will pick it up */ }
  log(forwarded ? 'subscribed' : 'stored_not_forwarded', source, httpStatus);
  return respond(request, 'subscribed', { forwarded });
}

export const onRequest = (context) => handleSubscribe(context.request, context.env);
