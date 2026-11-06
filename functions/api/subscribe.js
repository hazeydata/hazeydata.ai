// HD-SIGNUP-001 (R2 store-first): POST /api/subscribe -> D1 SIGNUPS, then best-effort Beehiiv v2 forward.
import {
  SOURCES, SOURCE_TAGS, ORIGIN_SOURCES, ALLOWED_ORIGINS, RATE_LIMIT, BEEHIIV_TIMEOUT_MS, STATUSES,
} from '../../assets/signup/signup-config.js';

const HTTP = { subscribed: 200, pending_confirmation: 200, already_subscribed: 200, invalid_email: 400, rate_limited: 429, error: 502 };
// Pragmatic server-side check (AC3). The browser's type=email is not trusted.
const EMAIL_RE = /^[^\s@"<>()\[\],;:\\]{1,64}@(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;
// Beehiiv documents subscription ids as sub_<uuid>. Anything else is never put into a URL.
const SUB_ID_RE = /^sub_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
  if (reason != null && !/^(timeout|network|config|d1_write|bad_response|(?:tag_)?http_[0-9]{3})$/.test(reason)) reason = null;
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

// Exact-origin CORS, no credentials. Callers only pass origins already checked against ALLOWED_ORIGINS.
function corsHeaders(origin) {
  return { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
}

function respond(request, status, extra = {}) {
  if (!STATUSES.includes(status)) status = 'error';
  const origin = request.headers.get('Origin');
  const cors = origin && ALLOWED_ORIGINS.includes(origin) ? corsHeaders(origin) : {};
  if (wantsJson(request)) {
    return new Response(JSON.stringify({ status, ...extra }), {
      status: HTTP[status],
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors },
    });
  }
  const u = redirectTarget(request);
  u.searchParams.set('signup', status);
  u.hash = 'signup';
  return new Response(null, { status: 303, headers: { Location: u.toString(), 'Cache-Control': 'no-store', ...cors } });
}

function preflight(request) {
  const origin = request.headers.get('Origin');
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) return new Response('Forbidden', { status: 403 });
  // Only POST is ever allowed; a preflight asking for anything else (or nothing) gets no CORS headers.
  if (request.headers.get('Access-Control-Request-Method') !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST, OPTIONS' } });
  const headers = { ...corsHeaders(origin), 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Max-Age': '600' };
  const asked = (request.headers.get('Access-Control-Request-Headers') || '').toLowerCase().split(',').map((h) => h.trim()).filter(Boolean);
  if (asked.includes('content-type')) headers['Access-Control-Allow-Headers'] = 'Content-Type';
  return new Response(null, { status: 204, headers });
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
    return { httpStatus: res.status, failure: null };
  } catch {
    return { httpStatus: null, failure: ctrl.signal.aborted ? 'timeout' : 'network' }; // fixed kinds only, never the error text
  } finally {
    clearTimeout(timer);
  }
}

function createBody(email, source, utm, request) {
  const body = { email, utm_source: source, reactivate_existing: false, send_welcome_email: false };
  if (utm.utm_medium) body.utm_medium = utm.utm_medium;
  if (utm.utm_campaign) body.utm_campaign = utm.utm_campaign;
  if (utm.utm_source) body.utm_content = utm.utm_source; // R1: incoming utm_source -> utm_content
  const ref = request.headers.get('Referer');
  if (ref) { try { const r = new URL(ref); if (ALLOWED_ORIGINS.includes(r.origin)) body.referring_site = r.origin + r.pathname; } catch { /* ignore */ } }
  return body;
}

// BEEHIIV-104: create, then tag, under one deadline and with no retry. ok is true only when both were accepted.
// Returns fixed kinds only (never upstream text, ids or errors).
async function createAndTag(env, body, tag, fetchImpl, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const base = `https://api.beehiiv.com/v2/publications/${encodeURIComponent(env.BEEHIIV_PUB_ID)}/subscriptions`;
  const post = (url, payload) => fetchImpl(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.BEEHIIV_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: ctrl.signal,
  });
  let httpStatus = null;
  try {
    const created = await post(base, body);
    httpStatus = created.status;
    if (!(httpStatus >= 200 && httpStatus < 300)) {
      try { await created.body?.cancel(); } catch { /* ignore */ }
      return { ok: false, httpStatus, reason: `http_${httpStatus}` };
    }
    let data;
    try { data = (await created.json())?.data; } catch { return { ok: false, httpStatus, reason: ctrl.signal.aborted ? 'timeout' : 'bad_response' }; }
    const id = data?.id;
    if (typeof id !== 'string' || !SUB_ID_RE.test(id)) return { ok: false, httpStatus, reason: 'bad_response' };
    const pending = data.status === 'pending' || data.status === 'validating';
    const tagged = await post(`${base}/${id}/tags`, { tags: [tag] });
    httpStatus = tagged.status;
    try { await tagged.body?.cancel(); } catch { /* ignore */ }
    if (!(httpStatus >= 200 && httpStatus < 300)) return { ok: false, httpStatus, reason: `tag_http_${httpStatus}` };
    return { ok: true, httpStatus, pending };
  } catch {
    return { ok: false, httpStatus, reason: ctrl.signal.aborted ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

export async function handleSubscribe(request, env, opts = {}) {
  const fetchImpl = opts.fetch || fetch;
  const timeoutMs = opts.timeoutMs ?? BEEHIIV_TIMEOUT_MS;
  const now = opts.now ?? Date.now();

  if (request.method === 'OPTIONS') return preflight(request);
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST, OPTIONS' } });
  }
  const origin = request.headers.get('Origin');
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) {
    log('forbidden_origin', null, null);
    return new Response('Forbidden', { status: 403 });
  }

  let form;
  try { form = await request.formData(); } catch { form = new FormData(); }
  // A sister-site origin can only submit its own source; hazeydata.ai origins pick from SOURCES.
  const source = ORIGIN_SOURCES[origin] ?? normalizeSource(String(form.get('source') || ''));
  const tag = Object.hasOwn(SOURCE_TAGS, source) ? SOURCE_TAGS[source] : null;

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
  if (!db) { log('error', source, null, 'config'); return respond(request, 'error'); }
  try {
    const r = await db.prepare(
      `INSERT INTO signups (email, source, utm_source, utm_medium, utm_campaign, created_at, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending') ON CONFLICT(email) DO NOTHING`,
    ).bind(email, source, utm.utm_source, utm.utm_medium, utm.utm_campaign, new Date(now).toISOString()).run();
    inserted = (r?.meta?.changes ?? 0) > 0;
  } catch {
    log('error', source, null, 'd1_write');
    return respond(request, 'error');
  }
  if (tag) return handleTagged({ request, env, db, email, source, tag, utm, fetchImpl, timeoutMs, now });
  if (!inserted) { log('already_subscribed', source, null); return respond(request, 'already_subscribed'); }

  // AC22/AC23: best-effort forward. The visitor sees success whatever Beehiiv does.
  let httpStatus = null;
  let failure = 'config';
  if (env.BEEHIIV_API_KEY && env.BEEHIIV_PUB_ID) {
    const body = createBody(email, source, utm, request);
    ({ httpStatus, failure } = await callBeehiiv(env, body, fetchImpl, timeoutMs));
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
  const reason = forwarded ? null : (failure || `http_${httpStatus}`);
  log(forwarded ? 'subscribed' : 'stored_not_forwarded', source, httpStatus, reason);
  return respond(request, 'subscribed');
}

// BEEHIIV-104: tagged sources. Success is reported only after Beehiiv accepted the create and the tag; any
// other outcome is an error and leaves the signups row pending (exportable), so a resubmit retries safely.
// The signups row (original source/UTM) is never rewritten; tag completion lives in signup_tags per email+tag.
async function handleTagged({ request, env, db, email, source, tag, utm, fetchImpl, timeoutMs, now }) {
  try {
    const done = await db.prepare('SELECT 1 AS done FROM signup_tags WHERE email = ? AND tag = ?').bind(email, tag).first();
    if (done) { log('already_subscribed', source, null); return respond(request, 'already_subscribed'); }
  } catch {
    log('error', source, null, 'd1_write');
    return respond(request, 'error');
  }
  if (!(env.BEEHIIV_API_KEY && env.BEEHIIV_PUB_ID)) { log('error', source, null, 'config'); return respond(request, 'error'); }

  const r = await createAndTag(env, createBody(email, source, utm, request), tag, fetchImpl, timeoutMs);
  if (!r.ok) {
    try {
      await db.prepare("UPDATE signups SET last_error_code = ? WHERE email = ? AND status = 'pending'").bind(r.httpStatus, email).run();
    } catch { /* row stays as stored */ }
    log('stored_not_forwarded', source, r.httpStatus, r.reason);
    return respond(request, 'error');
  }
  // Mark forwarded first: if the tag record then fails to write, a resubmit repeats the (idempotent) upstream calls.
  const stamp = new Date(now).toISOString();
  try {
    await db.prepare("UPDATE signups SET status = 'forwarded', forwarded_at = COALESCE(forwarded_at, ?), last_error_code = NULL WHERE email = ?").bind(stamp, email).run();
    await db.prepare('INSERT OR IGNORE INTO signup_tags (email, tag, tagged_at) VALUES (?, ?, ?)').bind(email, tag, stamp).run();
  } catch {
    log('error', source, r.httpStatus, 'd1_write');
    return respond(request, 'error');
  }
  const status = r.pending ? 'pending_confirmation' : 'subscribed';
  log(status, source, r.httpStatus, null);
  return respond(request, status);
}

export const onRequest = (context) => handleSubscribe(context.request, context.env);
