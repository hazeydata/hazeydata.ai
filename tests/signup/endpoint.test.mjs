// HD-SIGNUP-001 Phase 1 (AC1-AC10, AC19 logs, AC20 JS-on=JSON / JS-off=303).
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { handleSubscribe, _resetMemoryLimiter } from '../../functions/api/subscribe.js';
import { injectSignupStatus } from '../../functions/_middleware.js';
import { SOURCES, MESSAGES } from '../../assets/signup/signup-config.js';
import { ENV, ORIGIN, email, beehiivMock, captureLogs, assertCleanLogs } from './helpers.mjs';

let ipSeq = 0;
const used = [];
const logs = captureLogs();
after(() => { logs.restore(); assertCleanLogs(assert, logs.lines, used); });
beforeEach(() => _resetMemoryLimiter());

function req(fields, { json = true, method = 'POST', origin = ORIGIN, ip, referer = `${ORIGIN}/` } = {}) {
  if (fields.email) used.push(fields.email);
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': ip || `198.51.100.${++ipSeq % 250}` };
  if (json) headers.Accept = 'application/json';
  if (origin) headers.Origin = origin;
  if (referer) headers.Referer = referer;
  return new Request(`${ORIGIN}/api/subscribe`, { method, headers, body: method === 'POST' ? new URLSearchParams(fields) : undefined });
}
const call = (r, mock, opts = {}) => handleSubscribe(r, ENV, { fetch: mock, ...opts });
const loc = (res) => new URL(res.headers.get('Location'));

for (const mode of ['js', 'nojs']) {
  const json = mode === 'js';
  const expectStatus = async (res, want, http) => {
    if (json) { assert.equal(res.status, http); assert.deepEqual(await res.json(), { status: want }); }
    else { assert.equal(res.status, 303); assert.equal(loc(res).searchParams.get('signup'), want); assert.equal(loc(res).hash, '#signup'); }
  };

  test(`[${mode}] AC1 new email + allowlisted source -> subscribed, one Beehiiv call`, async () => {
    const m = beehiivMock();
    const res = await call(req({ email: email('new1'), source: 'openmillage', website: '' }, { json }), m);
    await expectStatus(res, 'subscribed', 200);
    assert.equal(m.calls.length, 1);
    assert.equal(m.calls[0].url, `https://api.beehiiv.com/v2/publications/${ENV.BEEHIIV_PUB_ID}/subscriptions`);
    assert.equal(m.calls[0].init.headers.Authorization, `Bearer ${ENV.BEEHIIV_API_KEY}`);
    assert.equal(m.calls[0].body.reactivate_existing, false);
  });

  test(`[${mode}] AC2 existing email -> already_subscribed, no detail`, async () => {
    const m = beehiivMock();
    const res = await call(req({ email: email('old1'), source: 'hazeydata' }, { json }), m);
    await expectStatus(res, 'already_subscribed', 200);
    assert.equal(m.calls.length, 1);
  });

  test(`[${mode}] AC3 malformed email -> invalid_email, no Beehiiv call`, async () => {
    for (const bad of ['', 'nope', 'a@b', 'a b@hazeydata.invalid', '<x>@hazeydata.invalid', 'a@-x.invalid']) {
      const m = beehiivMock();
      const res = await call(req({ email: bad, source: 'hazeydata' }, { json }), m);
      await expectStatus(res, 'invalid_email', 400);
      assert.equal(m.calls.length, 0, bad);
    }
  });

  test(`[${mode}] AC4 missing / unknown source stored as unknown, not rejected`, async () => {
    for (const src of [undefined, 'evil', 'HAZEYDATA']) {
      const m = beehiivMock();
      const f = { email: email('new4') }; if (src !== undefined) f.source = src;
      await expectStatus(await call(req(f, { json }), m), 'subscribed', 200);
      assert.equal(m.calls[0].body.utm_source, 'unknown');
    }
  });

  test(`[${mode}] AC5 source -> utm_source; supplied UTMs passed through`, async () => {
    const m = beehiivMock();
    await call(req({ email: email('new5'), source: 'k12comp', utm_source: 'x', utm_medium: 'social', utm_campaign: 'launch' }, { json }), m);
    const b = m.calls[0].body;
    assert.equal(b.utm_source, 'k12comp');
    assert.equal(b.utm_medium, 'social');
    assert.equal(b.utm_campaign, 'launch');
    assert.equal(b.utm_content, 'x');
    assert.equal(b.referring_site, `${ORIGIN}/`);
  });

  test(`[${mode}] AC6 honeypot -> subscribed-looking, no Beehiiv call`, async () => {
    const m = beehiivMock();
    await expectStatus(await call(req({ email: email('new6'), source: 'cdr', website: 'http://spam' }, { json }), m), 'subscribed', 200);
    assert.equal(m.calls.length, 0);
  });

  test(`[${mode}] AC7 6th request per IP in 10 min -> rate_limited 429, no Beehiiv call`, async () => {
    const m = beehiivMock();
    const ip = '203.0.113.7';
    for (let i = 0; i < 5; i++) await expectStatus(await call(req({ email: email(`new7${i}`) }, { json, ip }), m), 'subscribed', 200);
    assert.equal(m.calls.length, 5);
    await expectStatus(await call(req({ email: email('new7x') }, { json, ip }), m), 'rate_limited', 429);
    assert.equal(m.calls.length, 5);
    // next window resets
    const later = Date.now() + 601_000;
    await expectStatus(await call(req({ email: email('new7y') }, { json, ip }), beehiivMock(later), { now: later }), 'subscribed', 200);
  });

  test(`[${mode}] AC7 KV storage path (SIGNUP_RL binding)`, async () => {
    const store = new Map();
    const kv = { get: async (k) => store.get(k) ?? null, put: async (k, v, o) => { assert.ok(o.expirationTtl >= 600); store.set(k, v); } };
    const env = { ...ENV, SIGNUP_RL: kv };
    const m = beehiivMock();
    for (let i = 0; i < 5; i++) await handleSubscribe(req({ email: email(`kv${i}`) }, { json, ip: '203.0.113.8' }), env, { fetch: m });
    const res = await handleSubscribe(req({ email: email('kvx') }, { json, ip: '203.0.113.8' }), env, { fetch: m });
    await expectStatus(res, 'rate_limited', 429);
    assert.ok([...store.keys()].every((k) => !k.includes('203.0.113.8')), 'raw IP stored in KV key');
  });

  for (const [local, label] of [['slow', 'timeout >5s'], ['fail500', '5xx'], ['network', 'network failure'], ['badkey', 'bad key 401']]) {
    test(`[${mode}] AC8 Beehiiv ${label} -> error 502, no retry`, async () => {
      const m = beehiivMock();
      const t0 = Date.now();
      await expectStatus(await call(req({ email: email(`${local}8`) }, { json }), m, { timeoutMs: 50 }), 'error', 502);
      assert.equal(m.calls.length, 1);
      assert.ok(Date.now() - t0 < 2000);
    });
  }

  test(`[${mode}] AC8 default timeout is 5 s`, async () => {
    const { BEEHIIV_TIMEOUT_MS } = await import('../../assets/signup/signup-config.js');
    assert.equal(BEEHIIV_TIMEOUT_MS, 5000);
  });

  test(`[${mode}] AC9 non-POST -> 405; bad or missing Origin -> 403`, async () => {
    const m = beehiivMock();
    for (const method of ['GET', 'PUT', 'DELETE']) assert.equal((await call(req({}, { json, method }), m)).status, 405);
    assert.equal((await call(req({ email: email('new9') }, { json, origin: 'https://evil.example.com' }), m)).status, 403);
    assert.equal((await call(req({ email: email('new9') }, { json, origin: null }), m)).status, 403);
    assert.equal(m.calls.length, 0);
  });
}

test('no-JS redirect goes back to the referring allowlisted page, else home', async () => {
  const m = beehiivMock();
  let res = await call(req({ email: email('r1') }, { json: false, referer: `${ORIGIN}/cdr/?utm_medium=x&signup=error` }), m);
  assert.equal(loc(res).pathname, '/cdr/');
  assert.equal(loc(res).searchParams.get('signup'), 'subscribed');
  assert.equal(loc(res).searchParams.get('utm_medium'), 'x');
  res = await call(req({ email: email('r2') }, { json: false, referer: 'https://evil.example.com/x' }), m);
  assert.equal(loc(res).origin + loc(res).pathname, `${ORIGIN}/`);
});

test('missing secrets -> error without calling Beehiiv', async () => {
  const m = beehiivMock();
  const res = await handleSubscribe(req({ email: email('nosecret') }), {}, { fetch: m });
  assert.deepEqual(await res.json(), { status: 'error' });
  assert.equal(m.calls.length, 0);
});

test('AC4 allowlist: home + project slugs in one file', () => {
  assert.equal(SOURCES.length, new Set(SOURCES).size);
  assert.ok(SOURCES.includes('hazeydata'));
});

test('AC12 middleware renders each status message server-side', () => {
  const html = '<p class="hd-signup-status" role="status" aria-live="polite" data-signup-status></p>';
  for (const [s, msg] of Object.entries(MESSAGES)) {
    const out = injectSignupStatus(html, s);
    assert.ok(out.includes(`data-state="${s}">${msg.replace(/&/g, '&amp;')}</p>`), s);
  }
  assert.equal(injectSignupStatus(html, '<script>'), html);
});
