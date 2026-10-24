// HD-SIGNUP-001: POST /api/subscribe -> Beehiiv v2 create subscription.
import {
  SOURCES, ALLOWED_ORIGINS, RATE_LIMIT, BEEHIIV_TIMEOUT_MS, STATUSES,
} from '../../assets/signup/signup-config.js';

const HTTP = { subscribed: 200, already_subscribed: 200, invalid_email: 400, rate_limited: 429, error: 502 };
// Pragmatic server-side check (AC3). The browser's type=email is not trusted.
const EMAIL_RE = /^[^\s@"<>()\[\],;:\\]{1,64}@(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;
const UTM_RE = /^[A-Za-z0-9._-]{1,100}$/;
// Beehiiv returns 200 for an existing subscriber too. A record created more than this long ago is "already".
const ALREADY_AGE_SECONDS = 120;

const memoryBuckets = new Map(); // fallback when no KV binding: per-isolate only

export function isValidEmail(email) {
  return typeof email === 'string' && email.length <= 254 && EMAIL_RE.test(email);
}

export function normalizeSource(raw) {
  return SOURCES.includes(raw) ? raw : 'unknown';
}

function log(status, source, beehiivStatus) {
  // AC10: status, source and Beehiiv HTTP status only.
  console.log(JSON.stringify({ evt: 'signup', status, source, beehiiv_status: beehiivStatus ?? null }));
}

async function ipKey(ip, windowStart) {
  const data = new TextEncoder().encode(`hd-signup:${ip}`);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const hex = [...new Uint8Array(hash)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `rl:${windowStart}:${hex}`;
}

// AC7: fixed window, 5 per IP per 10 min. Storage: KV namespace bound as SIGNUP_RL.
export async function overLimit(env, ip, nowMs = Date.now()) {
  const windowStart = Math.floor(nowMs / 1000 / RATE_LIMIT.windowSeconds) * RATE_LIMIT.windowSeconds;
  const key = await ipKey(ip || 'none', windowStart);
  const kv = env.SIGNUP_RL;
  let count;
  if (kv) {
    count = (parseInt(await kv.get(key), 10) || 0) + 1;
    await kv.put(key, String(count), { expirationTtl: RATE_LIMIT.windowSeconds + 60 });
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

function respond(request, status) {
  if (!STATUSES.includes(status)) status = 'error';
  if (wantsJson(request)) {
    return new Response(JSON.stringify({ status }), {
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
    let json = null;
    if (res.ok) { try { json = await res.json(); } catch { json = null; } }
    return { httpStatus: res.status, json };
  } catch {
    return { httpStatus: null, json: null }; // timeout or network failure
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

  const email = String(form.get('email') || '').trim();
  if (!isValidEmail(email)) { log('invalid_email', source, null); return respond(request, 'invalid_email'); }

  if (!env.BEEHIIV_API_KEY || !env.BEEHIIV_PUB_ID) { log('error', source, null); return respond(request, 'error'); }

  const body = { email, utm_source: source, reactivate_existing: false, send_welcome_email: false };
  for (const k of ['utm_medium', 'utm_campaign']) {
    const v = String(form.get(k) || '');
    if (UTM_RE.test(v)) body[k] = v;
  }
  // OQ1 default: utm_source is the form's source slug. A utm_source the visitor arrived with
  // (e.g. ?utm_source=x on the page URL) is passed through as utm_content so neither is lost.
  const suppliedSource = String(form.get('utm_source') || '');
  if (UTM_RE.test(suppliedSource)) body.utm_content = suppliedSource;
  const ref = request.headers.get('Referer');
  if (ref) { try { const r = new URL(ref); if (ALLOWED_ORIGINS.includes(r.origin)) body.referring_site = r.origin + r.pathname; } catch { /* ignore */ } }

  const { httpStatus, json } = await callBeehiiv(env, body, fetchImpl, timeoutMs);
  let status;
  if (httpStatus === 200 || httpStatus === 201) {
    const created = Number(json?.data?.created);
    status = Number.isFinite(created) && created < now / 1000 - ALREADY_AGE_SECONDS ? 'already_subscribed' : 'subscribed';
  } else if (httpStatus === 400) {
    status = 'invalid_email';
  } else {
    status = 'error';
  }
  log(status, source, httpStatus);
  return respond(request, status);
}

export const onRequest = (context) => handleSubscribe(context.request, context.env);
