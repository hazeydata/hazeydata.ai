// HD-SIGNUP-001 endpoint + export (AC3-7, AC9-10, AC19-29). Each signup case runs as JSON (JS on) and 303 (JS off).
// Needs SIGNUP_TEST_TOOLS (sql.js provides a real SQLite behind a D1-shaped adapter).
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { handleSubscribe, _resetMemoryLimiter } from '../../functions/api/subscribe.js';
import { onRequest as exportRoute, csvCell, toCsv, tokenMatches } from '../../functions/api/signups/[file].js';
import { injectSignupStatus } from '../../functions/_middleware.js';
import { SOURCES, MESSAGES, ALLOWED_ORIGINS, BEEHIIV_TIMEOUT_MS, SOURCE_TAGS } from '../../assets/signup/signup-config.js';
import { ENV, EXPORT_TOKEN, ORIGIN, email, beehiivMock, SUB_ID, captureLogs, assertCleanLogs, makeD1 } from './helpers.mjs';

let ipSeq = 0;
const used = [];
const logs = captureLogs();
after(() => { logs.restore(); assertCleanLogs(assert, logs.lines, used); });
beforeEach(() => _resetMemoryLimiter());

function req(fields, { json = true, method = 'POST', origin = ORIGIN, ip, referer = `${ORIGIN}/` } = {}) {
  if (fields.email) used.push(fields.email);
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': ip || `test-ip-${++ipSeq}` };
  if (json) headers.Accept = 'application/json';
  if (origin) headers.Origin = origin;
  if (referer) headers.Referer = referer;
  return new Request(`${ORIGIN}/api/subscribe`, { method, headers, body: method === 'POST' ? new URLSearchParams(fields) : undefined });
}
async function setup(extra = {}) { return { ...ENV, SIGNUPS: await makeD1(extra.d1), ...extra.env }; }
const loc = (res) => new URL(res.headers.get('Location'));

for (const mode of ['js', 'nojs']) {
  const json = mode === 'js';
  const expectStatus = async (res, want, http) => {
    if (json) { assert.equal(res.status, http); assert.deepEqual(await res.json(), { status: want }); }
    else { assert.equal(res.status, 303); assert.equal(loc(res).searchParams.get('signup'), want); assert.equal(loc(res).hash, '#signup'); }
  };
  const T = (name, fn) => test(`[${mode}] ${name}`, fn);

  T('AC21/AC22 stored before Beehiiv; Beehiiv 2xx -> forwarded, subscribed', async () => {
    const env = await setup();
    let rowsAtCall = -1;
    const base = beehiivMock();
    const m = async (u, i) => { rowsAtCall = env.SIGNUPS.rows().length; return base(u, i); };
    await expectStatus(await handleSubscribe(req({ email: ` New1@HazeyData.INVALID `.replace(/HazeyData\.INVALID/, 'hazeydata.invalid'), source: 'openmillage' }, { json }), env, { fetch: m }), 'subscribed', 200);
    assert.equal(rowsAtCall, 1, 'row written before the Beehiiv call');
    const [r] = env.SIGNUPS.rows();
    assert.equal(r.email, 'new1@hazeydata.invalid');
    assert.equal(r.status, 'forwarded');
    assert.ok(r.forwarded_at);
    assert.equal(r.last_error_code, null);
    assert.equal(base.calls[0].body.utm_source, 'openmillage');
    assert.equal(base.calls[0].init.headers.Authorization, `Bearer ${ENV.BEEHIIV_API_KEY}`);
  });

  T('AC23 key missing -> subscribed, row pending, last_error_code null, no Beehiiv call', async () => {
    const env = await setup({ env: { BEEHIIV_API_KEY: undefined } });
    const m = beehiivMock();
    await expectStatus(await handleSubscribe(req({ email: email('nokey') }, { json }), env, { fetch: m }), 'subscribed', 200);
    assert.equal(m.calls.length, 0);
    const [r] = env.SIGNUPS.rows();
    assert.equal(r.status, 'pending'); assert.equal(r.last_error_code, null);
  });

  for (const [local, code] of [['badkey', 401], ['forbid', 403], ['fail500', 500], ['slow', null], ['network', null]]) {
    T(`AC23 Beehiiv ${code ?? local} -> subscribed, pending, last_error_code ${code}, no retry`, async () => {
      const env = await setup();
      const m = beehiivMock();
      await expectStatus(await handleSubscribe(req({ email: email(`${local}23`) }, { json }), env, { fetch: m, timeoutMs: 50 }), 'subscribed', 200);
      assert.equal(m.calls.length, 1);
      const [r] = env.SIGNUPS.rows();
      assert.equal(r.status, 'pending'); assert.equal(r.last_error_code, code);
    });
  }

  const lastLog = () => JSON.parse(logs.lines[logs.lines.length - 1]);

  for (const [local, code, reason] of [['fail500', 500, 'http_500'], ['badkey', 401, 'http_401'], ['network', null, 'network'], ['slow', null, 'timeout']]) {
    T(`Beehiiv ${code ?? local}: one pending row, last_error_code set, subscribed, stored_not_forwarded, reason ${reason}`, async () => {
      const env = await setup(); const m = beehiivMock();
      await expectStatus(await handleSubscribe(req({ email: email(`${local}fw`) }, { json }), env, { fetch: m, timeoutMs: 50 }), 'subscribed', 200);
      const rows = env.SIGNUPS.rows();
      assert.equal(rows.length, 1); assert.equal(rows[0].status, 'pending'); assert.equal(rows[0].last_error_code, code);
      assert.equal(lastLog().status, 'stored_not_forwarded'); assert.equal(lastLog().beehiiv_status, code); assert.equal(lastLog().reason, reason);
    });
  }

  T('Beehiiv 2xx: forwarded row, log subscribed', async () => {
    const env = await setup(); const m = beehiivMock();
    await expectStatus(await handleSubscribe(req({ email: email('okfw') }, { json }), env, { fetch: m }), 'subscribed', 200);
    const rows = env.SIGNUPS.rows();
    assert.equal(rows.length, 1); assert.equal(rows[0].status, 'forwarded');
    assert.equal(lastLog().status, 'subscribed'); assert.equal(lastLog().reason, null);
  });

  T('Beehiiv not configured: stored, stored_not_forwarded, reason config', async () => {
    const env = await setup({ env: { BEEHIIV_PUB_ID: undefined } });
    await expectStatus(await handleSubscribe(req({ email: email('nocfg') }, { json }), env, { fetch: beehiivMock() }), 'subscribed', 200);
    assert.equal(lastLog().status, 'stored_not_forwarded'); assert.equal(lastLog().beehiiv_status, null); assert.equal(lastLog().reason, 'config');
  });

  T('store missing table -> 502 error, Beehiiv not called, reason d1_write (AC32)', async () => {
    const env = await setup({ d1: { noSchema: true } }); const m = beehiivMock();
    const start = logs.lines.length; const src = SOURCES[0];
    await expectStatus(await handleSubscribe(req({ email: email('notable'), source: src }, { json }), env, { fetch: m }), 'error', 502);
    assert.equal(m.calls.length, 0);
    const emitted = logs.lines.slice(start);
    assert.equal(emitted.filter((l) => JSON.parse(l).evt === 'signup').length, 1);
    assert.deepEqual(JSON.parse(emitted[emitted.length - 1]), { evt: 'signup', status: 'error', source: src, beehiiv_status: null, reason: 'd1_write' });
    const blob = emitted.join('\n');
    assert.ok(!blob.includes(email('notable')) && !blob.includes('notable@'), 'email in log');
    assert.ok(!/\d{1,3}(\.\d{1,3}){3}/.test(blob), 'IP-like value in log');
    assert.ok(!blob.includes(ENV.BEEHIIV_API_KEY) && !blob.includes(ENV.BEEHIIV_PUB_ID), 'Beehiiv secret in log');
    assert.ok(!/D1_ERROR|no such table/i.test(blob), 'D1 error text in log');
  });

  T('SIGNUPS unbound -> error, reason config, Beehiiv not called', async () => {
    const m = beehiivMock();
    await expectStatus(await handleSubscribe(req({ email: email('unbound') }, { json }), { ...ENV }, { fetch: m }), 'error', 502);
    assert.equal(m.calls.length, 0);
    assert.equal(lastLog().reason, 'config');
  });

  T('store happens before Beehiiv: row exists in D1 when fetch is called', async () => {
    const env = await setup(); const base = beehiivMock(); let seen = null;
    const m = async (u, i) => { seen = env.SIGNUPS.rows().map((r) => [r.email, r.status]); return base(u, i); };
    await handleSubscribe(req({ email: email('order') }, { json }), env, { fetch: m });
    assert.deepEqual(seen, [[email('order'), 'pending']]);
  });

  T('AC24 store write fails -> error 502, no Beehiiv call, reason d1_write', async () => {
    const env = await setup({ d1: { failWrites: true } });
    const m = beehiivMock(); const src = SOURCES[0];
    const start = logs.lines.length;
    await expectStatus(await handleSubscribe(req({ email: email('storefail'), source: src }, { json }), env, { fetch: m }), 'error', 502);
    assert.equal(m.calls.length, 0);
    const emitted = logs.lines.slice(start).map((l) => JSON.parse(l)).filter((l) => l.evt === 'signup');
    assert.deepEqual(emitted, [{ evt: 'signup', status: 'error', source: src, beehiiv_status: null, reason: 'd1_write' }]);
    const noDb = { ...ENV };
    await expectStatus(await handleSubscribe(req({ email: email('nodb') }, { json }), noDb, { fetch: m }), 'error', 502);
    assert.equal(m.calls.length, 0);
  });

  T('AC24 D1 generic write error (not missing table) -> 502, no Beehiiv call, reason d1_write', async () => {
    const env = await setup({ d1: { failWrites: true, writeError: new Error('D1_ERROR: SQLITE_BUSY: database is locked') } });
    const m = beehiivMock(); const src = SOURCES[1] || SOURCES[0];
    const start = logs.lines.length;
    await expectStatus(await handleSubscribe(req({ email: email('d1busy'), source: src }, { json }), env, { fetch: m }), 'error', 502);
    assert.equal(m.calls.length, 0);
    assert.equal(env.SIGNUPS.rows().length, 0);
    const emitted = logs.lines.slice(start);
    const sig = emitted.map((l) => JSON.parse(l)).filter((l) => l.evt === 'signup');
    assert.deepEqual(sig, [{ evt: 'signup', status: 'error', source: src, beehiiv_status: null, reason: 'd1_write' }]);
    assert.ok(!/D1_ERROR|SQLITE_BUSY|locked/i.test(emitted.join('\n')), 'D1 error text in log');
  });

  T('AC25 existing email (any case) -> already_subscribed, no new row, no call, pending stays pending', async () => {
    const env = await setup({ env: { BEEHIIV_API_KEY: undefined } });
    const m = beehiivMock();
    await handleSubscribe(req({ email: email('dupe') }, { json }), env, { fetch: m });
    await expectStatus(await handleSubscribe(req({ email: 'DUPE@HAZEYDATA.INVALID' }, { json }), { ...env, BEEHIIV_API_KEY: ENV.BEEHIIV_API_KEY }, { fetch: m }), 'already_subscribed', 200);
    assert.equal(env.SIGNUPS.rows().length, 1);
    assert.equal(env.SIGNUPS.rows()[0].status, 'pending');
    assert.equal(m.calls.length, 0);
  });

  T('AC3 malformed email -> invalid_email, nothing stored, no call', async () => {
    for (const bad of ['', 'nope', 'a@b', 'a b@hazeydata.invalid', '<x>@hazeydata.invalid', 'a@-x.invalid']) {
      const env = await setup(); const m = beehiivMock();
      await expectStatus(await handleSubscribe(req({ email: bad }, { json }), env, { fetch: m }), 'invalid_email', 400);
      assert.equal(m.calls.length, 0, bad); assert.equal(env.SIGNUPS.rows().length, 0);
    }
  });

  T('AC4 missing / unknown source stored as unknown', async () => {
    for (const [i, src] of [undefined, 'evil', 'HAZEYDATA', '=HYPERLINK("x")'].entries()) {
      const env = await setup(); const m = beehiivMock();
      const f = { email: email(`src${i}`) }; if (src !== undefined) f.source = src;
      await expectStatus(await handleSubscribe(req(f, { json }), env, { fetch: m }), 'subscribed', 200);
      assert.equal(env.SIGNUPS.rows()[0].source, 'unknown');
      assert.equal(m.calls[0].body.utm_source, 'unknown');
    }
  });

  T('AC5 utm stored; Beehiiv gets source as utm_source, incoming utm_source as utm_content', async () => {
    const env = await setup(); const m = beehiivMock();
    await handleSubscribe(req({ email: email('utm5'), source: 'k12comp', utm_source: 'x', utm_medium: 'social', utm_campaign: 'launch' }, { json }), env, { fetch: m });
    const b = m.calls[0].body;
    assert.deepEqual([b.utm_source, b.utm_content, b.utm_medium, b.utm_campaign, b.referring_site], ['k12comp', 'x', 'social', 'launch', `${ORIGIN}/`]);
    const r = env.SIGNUPS.rows()[0];
    assert.deepEqual([r.source, r.utm_source, r.utm_medium, r.utm_campaign], ['k12comp', 'x', 'social', 'launch']);
  });

  T('AC6/AC29 honeypot -> subscribed-looking, nothing stored, no call', async () => {
    const env = await setup(); const m = beehiivMock();
    await expectStatus(await handleSubscribe(req({ email: email('hp6'), website: 'http://spam' }, { json }), env, { fetch: m }), 'subscribed', 200);
    assert.equal(m.calls.length, 0); assert.equal(env.SIGNUPS.rows().length, 0);
  });

  T('AC7/AC29 6th request per IP in 10 min -> rate_limited 429 (KV SIGNUP_RL), nothing stored', async () => {
    const store = new Map();
    const kv = { get: async (k) => store.get(k) ?? null, put: async (k, v, o) => { assert.ok(o.expirationTtl >= 600); store.set(k, v); } };
    const env = await setup({ env: { SIGNUP_RL: kv } }); const m = beehiivMock();
    for (let i = 0; i < 5; i++) await expectStatus(await handleSubscribe(req({ email: email(`rl${i}`) }, { json, ip: 'test-ip-rl' }), env, { fetch: m }), 'subscribed', 200);
    await expectStatus(await handleSubscribe(req({ email: email('rlx') }, { json, ip: 'test-ip-rl' }), env, { fetch: m }), 'rate_limited', 429);
    assert.equal(m.calls.length, 5); assert.equal(env.SIGNUPS.rows().length, 5);
    assert.ok([...store.keys()].every((k) => !k.includes('test-ip-rl')), 'raw IP in KV key');
    const later = Date.now() + 601_000;
    await expectStatus(await handleSubscribe(req({ email: email('rly') }, { json, ip: 'test-ip-rl' }), env, { fetch: m, now: later }), 'subscribed', 200);
  });

  T('AC9 non-POST -> 405; bad or missing Origin -> 403; nothing stored', async () => {
    const env = await setup(); const m = beehiivMock();
    for (const method of ['GET', 'PUT', 'DELETE']) assert.equal((await handleSubscribe(req({}, { json, method }), env, { fetch: m })).status, 405);
    for (const origin of ['https://evil.example.com', 'https://hazeydata.pages.dev', null]) assert.equal((await handleSubscribe(req({ email: email('o9') }, { json, origin }), env, { fetch: m })).status, 403);
    assert.equal((await handleSubscribe(req({ email: email('www9') }, { json, origin: 'https://www.hazeydata.ai' }), env, { fetch: m })).status, json ? 200 : 303);
    assert.equal(env.SIGNUPS.rows().length, 1);
  });
}

test('AC31 response is byte-identical whether Beehiiv succeeds, fails, or is not configured', async () => {
  const cases = [
    ['ok31', {}, undefined],
    ['fail500', {}, undefined],
    ['nocfg31', { env: { BEEHIIV_API_KEY: undefined } }, undefined],
  ];
  for (const json of [true, false]) {
    const seen = [];
    for (const [local, extra] of cases.map(([l, e]) => [l, e])) {
      const env = await setup(extra);
      const res = await handleSubscribe(req({ email: email(`${local}x${json}`) }, { json, referer: `${ORIGIN}/cdr/` }), env, { fetch: beehiivMock() });
      seen.push({ status: res.status, type: res.headers.get('Content-Type'), location: res.headers.get('Location'), body: await res.text() });
    }
    assert.deepEqual(seen[1], seen[0]);
    assert.deepEqual(seen[2], seen[0]);
    if (json) assert.equal(seen[0].body, '{"status":"subscribed"}');
  }
});

test('AC32 Beehiiv 500: exactly one log line, fixed shape, no email/IP/body/key', async () => {
  const env = await setup(); const ip = 'test-ip-ac32-77'; const addr = email('fail500ac32');
  const before = logs.lines.length;
  await handleSubscribe(req({ email: addr, source: 'cdr' }, { ip }), env, { fetch: beehiivMock() });
  const mine = logs.lines.slice(before);
  assert.equal(mine.length, 1);
  assert.deepEqual(JSON.parse(mine[0]), { evt: 'signup', status: 'stored_not_forwarded', source: 'cdr', beehiiv_status: 500, reason: 'http_500' });
  for (const secret of [addr, addr.split('@')[0], ip, 'boom', ENV.BEEHIIV_API_KEY]) assert.ok(!mine[0].includes(secret), secret);
});

test('AC32 reasons: timeout, network, config, http_401', async () => {
  const cases = [['slowac32', {}, 'timeout'], ['networkac32', {}, 'network'], ['cfgac32', { env: { BEEHIIV_API_KEY: undefined } }, 'config'], ['badkeyac32', {}, 'http_401']];
  for (const [local, extra, reason] of cases) {
    const env = await setup(extra); const before = logs.lines.length;
    await handleSubscribe(req({ email: email(local) }), env, { fetch: beehiivMock(), timeoutMs: 50 });
    const mine = logs.lines.slice(before).map((l) => JSON.parse(l));
    assert.equal(mine.length, 1); assert.equal(mine[0].reason, reason, local);
  }
});

test('AC8 default Beehiiv timeout is 5 s; AC9 origins: hazeydata.ai, www, plus BEEHIIV-104 sister sites (exact)', () => {
  assert.equal(BEEHIIV_TIMEOUT_MS, 5000);
  assert.deepEqual(ALLOWED_ORIGINS, [
    'https://hazeydata.ai', 'https://www.hazeydata.ai',
    'https://k12comp.com', 'https://www.k12comp.com', 'https://openmillage.com', 'https://www.openmillage.com',
  ]);
});

test('no-JS redirect goes back to the referring allowlisted page, else home', async () => {
  const env = await setup(); const m = beehiivMock();
  let res = await handleSubscribe(req({ email: email('r1') }, { json: false, referer: `${ORIGIN}/cdr/?utm_medium=x&signup=error` }), env, { fetch: m });
  assert.equal(loc(res).pathname, '/cdr/'); assert.equal(loc(res).searchParams.get('signup'), 'subscribed'); assert.equal(loc(res).searchParams.get('utm_medium'), 'x');
  res = await handleSubscribe(req({ email: email('r2') }, { json: false, referer: 'https://evil.example.com/x' }), env, { fetch: m });
  assert.equal(loc(res).origin + loc(res).pathname, `${ORIGIN}/`);
});

test('AC4 allowlist: home + 8 project slugs in one file', () => {
  assert.equal(SOURCES.length, 9); assert.equal(new Set(SOURCES).size, 9); assert.ok(SOURCES.includes('project-8'));
});

test('AC12 middleware renders each status message server-side', () => {
  const html = '<p class="hd-signup-status" role="status" aria-live="polite" data-signup-status></p>';
  for (const [s, msg] of Object.entries(MESSAGES)) assert.ok(injectSignupStatus(html, s).includes(`data-state="${s}">${msg.replace(/&/g, '&amp;')}</p>`), s);
  assert.equal(injectSignupStatus(html, '<script>'), html);
});

// ---- export (AC26-28) ----
const NOT_FOUND_HTML = '<!doctype html><title>404</title><p>Not here.</p>';
const ASSETS = { fetch: async () => new Response(NOT_FOUND_HTML, { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } }) };
const unknownPath = () => ASSETS.fetch(new Request(`${ORIGIN}/no-such-page`));
async function exp(env, { auth, file = 'export.csv', method = 'GET' } = {}) {
  const headers = auth ? { Authorization: auth } : {};
  return exportRoute({ request: new Request(`${ORIGIN}/api/signups/${file}`, { method, headers }), env: { ASSETS, EXPORT_TOKEN, ...env }, params: { file } });
}
async function sameAs404(res) {
  const ref = await unknownPath();
  assert.equal(res.status, ref.status);
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), Buffer.from(await ref.arrayBuffer()));
  assert.equal(res.headers.get('Content-Type'), ref.headers.get('Content-Type'));
}

test('AC26 no / wrong / malformed token, other methods and files -> 404 byte-identical to an unknown path', async () => {
  const env = { SIGNUPS: await makeD1() };
  for (const auth of [undefined, 'Bearer wrong', `bearer ${EXPORT_TOKEN}`, EXPORT_TOKEN, `Bearer ${EXPORT_TOKEN}x`, 'Basic abc']) await sameAs404(await exp(env, { auth }));
  await sameAs404(await exp(env, { auth: `Bearer ${EXPORT_TOKEN}`, method: 'POST' }));
  await sameAs404(await exp(env, { auth: `Bearer ${EXPORT_TOKEN}`, file: 'export.json' }));
  await sameAs404(await exp({ ...env, EXPORT_TOKEN: undefined }, { auth: 'Bearer ' }));
});

test('AC26 with token: pending rows only, exact columns, CSV content type', async () => {
  const SIGNUPS = await makeD1();
  const m = beehiivMock();
  await handleSubscribe(req({ email: email('fwd26') }), { ...ENV, SIGNUPS }, { fetch: m }); // forwarded
  await handleSubscribe(req({ email: email('pend26'), source: 'cdr', utm_medium: 'social' }), { SIGNUPS }, { fetch: m }); // pending
  const res = await exp({ SIGNUPS }, { auth: `Bearer ${EXPORT_TOKEN}` });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('Content-Type'), /^text\/csv/);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  const lines = (await res.text()).split('\r\n');
  assert.equal(lines[0], 'email,source,utm_source,utm_medium,utm_campaign,created_at');
  assert.equal(lines.length, 3); assert.equal(lines[2], '');
  assert.match(lines[1], /^pend26@hazeydata\.invalid,cdr,,social,,\d{4}-\d\d-\d\dT/);
});

test('AC27 CSV escaping: formula prefixes, RFC 4180 quoting', async () => {
  assert.equal(csvCell('=HYPERLINK("http://x","y")'), `"'=HYPERLINK(""http://x"",""y"")"`);
  for (const c of ['+1', '-1', '@a', '\tx']) assert.equal(csvCell(c), `'${c}`);
  assert.equal(csvCell('\rx'), `"'\rx"`);
  assert.equal(csvCell('a,b'), '"a,b"'); assert.equal(csvCell('say "hi"'), '"say ""hi"""'); assert.equal(csvCell('a\nb'), '"a\nb"');
  assert.equal(csvCell(null), ''); assert.equal(csvCell('plain'), 'plain');
  // AC30 shape: a planted =HYPERLINK source in storage is escaped in the export
  const SIGNUPS = await makeD1();
  await SIGNUPS.prepare("INSERT INTO signups (email, source, created_at) VALUES (?, ?, ?)").bind('=cmd@hazeydata.invalid', '=HYPERLINK("http://evil.example.com","x")', '2026-10-24T02:00:00.000Z').run();
  const body = await (await exp({ SIGNUPS }, { auth: `Bearer ${EXPORT_TOKEN}` })).text();
  assert.ok(body.includes(`'=cmd@hazeydata.invalid,"'=HYPERLINK(""http://evil.example.com"",""x"")"`), body);
  assert.equal(toCsv([]), 'email,source,utm_source,utm_medium,utm_campaign,created_at\r\n');
});

test('AC28 token compare: constant-time shape, never matches when unset', async () => {
  assert.equal(await tokenMatches(`Bearer ${EXPORT_TOKEN}`, EXPORT_TOKEN), true);
  assert.equal(await tokenMatches(`Bearer ${EXPORT_TOKEN.slice(0, -1)}`, EXPORT_TOKEN), false);
  assert.equal(await tokenMatches('Bearer ', undefined), false);
  assert.equal(await tokenMatches(undefined, EXPORT_TOKEN), false);
});

test('AC30 shape: key removed -> success + one pending row -> export returns it -> repeat is already_subscribed', async () => {
  const SIGNUPS = await makeD1(); const m = beehiivMock(); const env = { SIGNUPS };
  assert.deepEqual(await (await handleSubscribe(req({ email: email('kitty30') }), env, { fetch: m })).json(), { status: 'subscribed' });
  assert.equal(SIGNUPS.rows().length, 1); assert.equal(SIGNUPS.rows()[0].status, 'pending');
  const csv = await (await exp(env, { auth: `Bearer ${EXPORT_TOKEN}` })).text();
  assert.ok(csv.split('\r\n')[1].startsWith('kitty30@hazeydata.invalid,'));
  assert.deepEqual(await (await handleSubscribe(req({ email: email('kitty30') }), env, { fetch: m })).json(), { status: 'already_subscribed' });
  assert.equal(SIGNUPS.rows().length, 1);
});

// ---- BEEHIIV-104 Phase 1: tagged sources (create, then tag), CORS ----
const TAGGED = ['k12comp', 'agentwebindex', 'openmillage'];
const BASE = `https://api.beehiiv.com/v2/publications/${ENV.BEEHIIV_PUB_ID}/subscriptions`;
const post = (env, m, fields, opts = {}) => handleSubscribe(req(fields, opts), env, { fetch: m, timeoutMs: 50 });
const kinds = (m) => m.calls.map((c) => c.kind);
const sigLogs = (start) => logs.lines.slice(start).map((l) => JSON.parse(l)).filter((l) => l.evt === 'signup');

test('B104 source map is exactly the three sources, tag = fixed name', () => {
  assert.deepEqual(SOURCE_TAGS, { k12comp: 'k12comp', agentwebindex: 'agentwebindex', openmillage: 'openmillage' });
});

for (const src of TAGGED) {
  test(`B104 ${src}: create then exact tag URL/body, subscribed, row forwarded, tag recorded`, async () => {
    const env = await setup(); const m = beehiivMock();
    const res = await post(env, m, { email: email(`tag-${src}`), source: src });
    assert.deepEqual(await res.json(), { status: 'subscribed' });
    assert.equal(res.status, 200);
    assert.deepEqual(kinds(m), ['create', 'tag']);
    assert.equal(m.calls[0].url, BASE);
    assert.equal(m.calls[0].body.reactivate_existing, false);
    assert.equal(m.calls[1].url, `${BASE}/${SUB_ID(1)}/tags`);
    assert.deepEqual(m.calls[1].body, { tags: [src] });
    assert.equal(m.calls[1].init.method, 'POST');
    assert.equal(m.calls[1].init.headers.Authorization, `Bearer ${ENV.BEEHIIV_API_KEY}`);
    assert.equal(env.SIGNUPS.rows()[0].status, 'forwarded');
    assert.deepEqual(env.SIGNUPS.tagRows(), [{ email: email(`tag-${src}`), tag: src }]);
  });
}

test('B104 create and tag share one AbortSignal', async () => {
  const env = await setup(); const m = beehiivMock();
  await post(env, m, { email: email('sig1'), source: 'k12comp' });
  assert.ok(m.calls[0].init.signal && m.calls[0].init.signal === m.calls[1].init.signal);
});

test('B104 single deadline covers create + tag: slow create then tag cannot restart the clock', async () => {
  const env = await setup();
  const base = beehiivMock(); let t0;
  const m = async (u, i) => { t0 ??= Date.now(); if (/\/tags$/.test(u)) { await new Promise((r) => setTimeout(r, 80)); i.signal.throwIfAborted(); } else await new Promise((r) => setTimeout(r, 60)); return base(u, i); };
  const res = await handleSubscribe(req({ email: email('deadline'), source: 'k12comp' }), env, { fetch: m, timeoutMs: 100 });
  assert.equal(res.status, 502);
  assert.equal(env.SIGNUPS.rows()[0].status, 'pending');
});

test('B104 unknown / untagged sources never tag and keep legacy contract', async () => {
  for (const [i, src] of [undefined, 'evil', 'hazeydata', 'cdr', 'K12COMP', 'constructor', 'toString'].entries()) {
    const env = await setup(); const m = beehiivMock();
    const f = { email: email(`untag${i}`) }; if (src !== undefined) f.source = src;
    const res = await post(env, m, f);
    assert.deepEqual(await res.json(), { status: 'subscribed' });
    assert.deepEqual(kinds(m), ['create']);
    assert.deepEqual(env.SIGNUPS.tagRows(), []);
  }
  // create failure on an untagged source is still the legacy best-effort 'subscribed'
  const env = await setup();
  assert.deepEqual(await (await post(env, beehiivMock(), { email: email('fail500untag'), source: 'cdr' })).json(), { status: 'subscribed' });
});

for (const [local, reason, code] of [['fail500', 'http_500', 500], ['badkey', 'http_401', 401], ['forbid', 'http_403', 403], ['network', 'network', null], ['slow', 'timeout', null]]) {
  test(`B104 create ${reason} -> error 502, row pending exportable, no tag, no false success`, async () => {
    const env = await setup(); const m = beehiivMock(); const start = logs.lines.length;
    const res = await post(env, m, { email: email(`${local}c`), source: 'openmillage' });
    assert.equal(res.status, 502); assert.deepEqual(await res.json(), { status: 'error' });
    assert.deepEqual(kinds(m), ['create']);
    const [r] = env.SIGNUPS.rows();
    assert.equal(r.status, 'pending'); assert.equal(r.last_error_code, code);
    assert.deepEqual(env.SIGNUPS.tagRows(), []);
    assert.deepEqual(sigLogs(start), [{ evt: 'signup', status: 'stored_not_forwarded', source: 'openmillage', beehiiv_status: code, reason }]);
    const csv = await (await exp(env, { auth: `Bearer ${EXPORT_TOKEN}` })).text();
    assert.ok(csv.includes(email(`${local}c`)), 'pending row exportable');
  });
}

for (const [local, reason, code] of [['tagfail500', 'tag_http_500', 500], ['tagforbid', 'tag_http_403', 403], ['tagnetwork', 'network', null], ['tagslow', 'timeout', null]]) {
  test(`B104 tag ${reason} -> error, not forwarded, row pending, no extra retry`, async () => {
    const env = await setup(); const m = beehiivMock(); const start = logs.lines.length;
    const res = await post(env, m, { email: email(local), source: 'k12comp' });
    assert.equal(res.status, 502); assert.deepEqual(await res.json(), { status: 'error' });
    assert.deepEqual(kinds(m), ['create', 'tag']);
    const [r] = env.SIGNUPS.rows();
    assert.equal(r.status, 'pending'); assert.equal(r.forwarded_at, null);
    assert.deepEqual(env.SIGNUPS.tagRows(), []);
    const sig = sigLogs(start);
    assert.equal(sig.length, 1); assert.equal(sig[0].status, 'stored_not_forwarded'); assert.equal(sig[0].reason, reason);
  });
}

for (const local of ['badjson', 'noid', 'numid', 'shapeid', 'pathid', 'nodata']) {
  test(`B104 create 2xx with ${local} -> error, no tag call, row pending`, async () => {
    const env = await setup(); const m = beehiivMock(); const start = logs.lines.length;
    const res = await post(env, m, { email: email(local), source: 'agentwebindex' });
    assert.equal(res.status, 502); assert.deepEqual(await res.json(), { status: 'error' });
    assert.deepEqual(kinds(m), ['create']);
    assert.equal(env.SIGNUPS.rows()[0].status, 'pending');
    assert.deepEqual(env.SIGNUPS.tagRows(), []);
    assert.equal(sigLogs(start)[0].reason, 'bad_response');
  });
}

test('B104 missing config for a tagged source -> error, row pending, no upstream call', async () => {
  for (const missing of [{ BEEHIIV_API_KEY: undefined }, { BEEHIIV_PUB_ID: undefined }]) {
    const env = await setup({ env: missing }); const m = beehiivMock(); const start = logs.lines.length;
    const res = await post(env, m, { email: email('cfg104'), source: 'openmillage' });
    assert.equal(res.status, 502); assert.deepEqual(await res.json(), { status: 'error' });
    assert.equal(m.calls.length, 0);
    assert.equal(env.SIGNUPS.rows()[0].status, 'pending');
    assert.equal(sigLogs(start)[0].reason, 'config');
  }
});

test('B104 pending/validating create status -> pending_confirmation only after tag succeeded', async () => {
  for (const local of ['pendingsub', 'validatingsub']) {
    const env = await setup(); const m = beehiivMock();
    const res = await post(env, m, { email: email(local), source: 'k12comp' });
    assert.equal(res.status, 200); assert.deepEqual(await res.json(), { status: 'pending_confirmation' });
    assert.deepEqual(kinds(m), ['create', 'tag']);
    assert.equal(env.SIGNUPS.rows()[0].status, 'forwarded');
  }
  const env = await setup(); const base = beehiivMock();
  const failTag = async (u, i) => (/\/tags$/.test(u) ? new Response('{}', { status: 500 }) : base(u, i));
  const res = await handleSubscribe(req({ email: email('pendingsubx'), source: 'k12comp' }), env, { fetch: failTag });
  assert.deepEqual(await res.json(), { status: 'error' });
});

test('B104 pending_confirmation copy is generic, no delivery promise', () => {
  assert.equal(MESSAGES.pending_confirmation, 'Your subscription is pending confirmation.');
});

test('B104 failed row retries on resubmit (create+tag again), then duplicate makes no upstream call', async () => {
  const env = await setup();
  const addr = email('retry104');
  const m1 = beehiivMock();
  // first attempt: tag fails (key the failure on the local part via a wrapper)
  const failing = async (u, i) => (/\/tags$/.test(u) ? new Response('{}', { status: 500 }) : m1(u, i));
  assert.equal((await handleSubscribe(req({ email: addr, source: 'openmillage', utm_medium: 'one' }), env, { fetch: failing })).status, 502);
  assert.equal(env.SIGNUPS.rows()[0].status, 'pending');
  const m2 = beehiivMock();
  const ok = await post(env, m2, { email: addr, source: 'openmillage', utm_medium: 'two' });
  assert.deepEqual(await ok.json(), { status: 'subscribed' });
  assert.deepEqual(kinds(m2), ['create', 'tag']);
  assert.equal(m2.calls[0].body.reactivate_existing, false);
  assert.equal(env.SIGNUPS.rows().length, 1);
  assert.equal(env.SIGNUPS.rows()[0].status, 'forwarded');
  assert.equal(env.SIGNUPS.rows()[0].utm_medium, 'one', 'original UTM preserved');
  const m3 = beehiivMock();
  const dup = await post(env, m3, { email: addr.toUpperCase(), source: 'openmillage' });
  assert.deepEqual(await dup.json(), { status: 'already_subscribed' });
  assert.equal(m3.calls.length, 0);
  assert.equal(env.SIGNUPS.tagRows().length, 1);
});

test('B104 existing untagged-source row: tagged source still creates+tags once, original source/UTM kept', async () => {
  const env = await setup(); const addr = email('cross104');
  await post(env, beehiivMock(), { email: addr, source: 'hazeydata', utm_source: 'orig', utm_medium: 'm0' });
  const before = env.SIGNUPS.rows()[0];
  const m = beehiivMock();
  const res = await post(env, m, { email: addr, source: 'k12comp', utm_source: 'new', utm_medium: 'm1' });
  assert.deepEqual(await res.json(), { status: 'subscribed' });
  assert.deepEqual(kinds(m), ['create', 'tag']);
  assert.equal(m.calls[0].body.utm_source, 'k12comp');
  assert.deepEqual(m.calls[1].body, { tags: ['k12comp'] });
  const rows = env.SIGNUPS.rows();
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].source, rows[0].utm_source, rows[0].utm_medium, rows[0].created_at], [before.source, before.utm_source, before.utm_medium, before.created_at]);
  const m2 = beehiivMock();
  assert.deepEqual(await (await post(env, m2, { email: addr, source: 'k12comp' })).json(), { status: 'already_subscribed' });
  assert.equal(m2.calls.length, 0);
  // a different tagged source for the same email is tagged separately
  const m3 = beehiivMock();
  assert.deepEqual(await (await post(env, m3, { email: addr, source: 'openmillage' })).json(), { status: 'subscribed' });
  assert.deepEqual(m3.calls[1].body, { tags: ['openmillage'] });
  // an untagged source on an existing row keeps legacy already_subscribed
  const m4 = beehiivMock();
  assert.deepEqual(await (await post(env, m4, { email: addr, source: 'cdr' })).json(), { status: 'already_subscribed' });
  assert.equal(m4.calls.length, 0);
});

test('B104 failed tag on an existing forwarded row leaves it forwarded and reports error', async () => {
  const env = await setup(); const addr = email('tagfail500x');
  await post(env, beehiivMock(), { email: addr, source: 'hazeydata' });
  const res = await post(env, beehiivMock(), { email: addr, source: 'k12comp' });
  assert.equal(res.status, 502);
  assert.equal(env.SIGNUPS.rows()[0].status, 'forwarded');
  assert.deepEqual(env.SIGNUPS.tagRows(), []);
});

test('B104 D1 errors stay errors: write failure, tag-record write failure', async () => {
  let env = await setup({ d1: { failWrites: true } }); let m = beehiivMock();
  assert.equal((await post(env, m, { email: email('d1a'), source: 'k12comp' })).status, 502);
  assert.equal(m.calls.length, 0);
  env = await setup({ d1: { failTagWrites: true } }); m = beehiivMock();
  const res = await post(env, m, { email: email('d1b'), source: 'k12comp' });
  assert.equal(res.status, 502); assert.deepEqual(await res.json(), { status: 'error' });
  const m2 = beehiivMock();
  assert.equal((await post(env, m2, { email: email('d1b'), source: 'k12comp' })).status, 502);
  assert.deepEqual(kinds(m2), ['create', 'tag'], 'retried upstream because no tag record');
  env = await setup({ d1: { noSchema: true } });
  assert.equal((await post(env, beehiivMock(), { email: email('d1c'), source: 'k12comp' })).status, 502);
});

test('B104 tagged logs: fixed shape, no PII/ids/keys', async () => {
  const env = await setup(); const start = logs.lines.length;
  await post(env, beehiivMock(), { email: email('logok'), source: 'k12comp' });
  await post(env, beehiivMock(), { email: email('tagfail500log'), source: 'k12comp' });
  const mine = logs.lines.slice(start).join('\n');
  assert.ok(!mine.includes('sub_') && !mine.includes('boom'));
  assert.deepEqual(sigLogs(start).map((l) => l.status), ['subscribed', 'stored_not_forwarded']);
});

test('B104 honeypot / invalid email / rate limit unchanged for tagged sources', async () => {
  const env = await setup(); const m = beehiivMock();
  assert.deepEqual(await (await post(env, m, { email: email('hp104'), source: 'k12comp', website: 'x' })).json(), { status: 'subscribed' });
  assert.deepEqual(await (await post(env, m, { email: 'bad', source: 'k12comp' })).json(), { status: 'invalid_email' });
  assert.equal(m.calls.length, 0);
  for (let i = 0; i < 5; i++) await post(env, m, { email: email(`rl104${i}`), source: 'k12comp' }, { ip: 'rl-104' });
  assert.equal((await post(env, m, { email: email('rl104x'), source: 'k12comp' }, { ip: 'rl-104' })).status, 429);
});

test('B104 no-JS tagged: success redirects with subscribed, failure with error; tag failure is not forwarded', async () => {
  const env = await setup();
  let res = await post(env, beehiivMock(), { email: email('nj1'), source: 'k12comp' }, { json: false });
  assert.equal(loc(res).searchParams.get('signup'), 'subscribed');
  res = await post(env, beehiivMock(), { email: email('tagfail500nj'), source: 'k12comp' }, { json: false });
  assert.equal(res.status, 303); assert.equal(loc(res).searchParams.get('signup'), 'error');
});

// CORS
const SISTER = [['https://k12comp.com', 'k12comp'], ['https://www.k12comp.com', 'k12comp'], ['https://openmillage.com', 'openmillage'], ['https://www.openmillage.com', 'openmillage']];

test('B104 OPTIONS from each allowed origin -> 204 exact-origin CORS, POST/OPTIONS, Content-Type only if requested, no credentials', async () => {
  const env = await setup();
  for (const origin of ALLOWED_ORIGINS) {
    const r = new Request(`${ORIGIN}/api/subscribe`, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'Content-Type' } });
    const res = await handleSubscribe(r, env, { fetch: beehiivMock() });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), origin);
    assert.equal(res.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS');
    assert.equal(res.headers.get('Access-Control-Allow-Headers'), 'Content-Type');
    assert.equal(res.headers.get('Access-Control-Allow-Credentials'), null);
    assert.match(res.headers.get('Vary'), /Origin/);
  }
  const noHdr = await handleSubscribe(new Request(`${ORIGIN}/api/subscribe`, { method: 'OPTIONS', headers: { Origin: 'https://k12comp.com', 'Access-Control-Request-Method': 'POST' } }), env, {});
  assert.equal(noHdr.headers.get('Access-Control-Allow-Headers'), null);
  const other = await handleSubscribe(new Request(`${ORIGIN}/api/subscribe`, { method: 'OPTIONS', headers: { Origin: 'https://k12comp.com', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'X-Evil, Authorization' } }), env, {});
  assert.equal(other.headers.get('Access-Control-Allow-Headers'), null);
});

test('B104 OPTIONS asking for a method other than POST (or none) -> 405, no CORS headers', async () => {
  const env = await setup();
  for (const method of ['GET', 'PUT', 'DELETE', 'post', undefined]) {
    const headers = { Origin: 'https://k12comp.com', ...(method ? { 'Access-Control-Request-Method': method } : {}) };
    const res = await handleSubscribe(new Request(`${ORIGIN}/api/subscribe`, { method: 'OPTIONS', headers }), env, {});
    assert.equal(res.status, 405, String(method));
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), null);
    assert.equal(res.headers.get('Access-Control-Allow-Methods'), null);
  }
});

test('B104 OPTIONS from unrelated/lookalike/missing origin -> 403, no CORS headers', async () => {
  const env = await setup();
  for (const origin of ['https://evil.example.com', 'https://k12comp.com.evil.com', 'http://k12comp.com', 'https://sub.k12comp.com', 'https://k12comp.com:8443', 'https://openmillage.org', 'null', 'https://K12COMP.com', null]) {
    const headers = origin ? { Origin: origin } : {};
    const res = await handleSubscribe(new Request(`${ORIGIN}/api/subscribe`, { method: 'OPTIONS', headers }), env, {});
    assert.equal(res.status, 403, String(origin));
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), null);
  }
});

test('B104 POST from unrelated origin -> 403 without CORS headers, nothing stored', async () => {
  const env = await setup(); const m = beehiivMock();
  for (const origin of ['https://k12comp.com.evil.com', 'http://openmillage.com', 'https://evil.example.com']) {
    const res = await post(env, m, { email: email('bad104'), source: 'k12comp' }, { origin });
    assert.equal(res.status, 403); assert.equal(res.headers.get('Access-Control-Allow-Origin'), null);
  }
  assert.equal(m.calls.length, 0); assert.equal(env.SIGNUPS.rows().length, 0);
});

test('B104 POST responses carry ACAO for the exact origin (success, error, invalid, honeypot, rate limit, no-JS), never credentials', async () => {
  const env = await setup();
  for (const [origin, src] of SISTER) {
    const checks = [
      await post(env, beehiivMock(), { email: email(`cors-${origin.length}-${src}`), source: src }, { origin, referer: `${origin}/` }),
      await post(env, beehiivMock(), { email: email(`tagfail500cors${origin.length}`), source: src }, { origin }),
      await post(env, beehiivMock(), { email: 'bad', source: src }, { origin }),
      await post(env, beehiivMock(), { email: email('hpc'), source: src, website: 'x' }, { origin }),
      await post(env, beehiivMock(), { email: email(`nj-${origin.length}-${src}`), source: src }, { origin, json: false, referer: `${origin}/signup` }),
    ];
    for (const res of checks) {
      assert.equal(res.headers.get('Access-Control-Allow-Origin'), origin);
      assert.match(res.headers.get('Vary'), /Origin/);
      assert.equal(res.headers.get('Access-Control-Allow-Credentials'), null);
    }
    assert.equal(checks[4].status, 303);
    assert.equal(loc(checks[4]).origin, origin, 'no-JS redirect returns to the sister site');
  }
  const rl = await post(env, beehiivMock(), { email: email('rlcors'), source: 'k12comp' }, { origin: 'https://k12comp.com', ip: 'rl-cors' });
  assert.equal(rl.headers.get('Access-Control-Allow-Origin'), 'https://k12comp.com');
  for (let i = 0; i < 5; i++) await post(env, beehiivMock(), { email: email(`rlc${i}`) }, { origin: 'https://k12comp.com', ip: 'rl-cors' });
  const limited = await post(env, beehiivMock(), { email: email('rlcx') }, { origin: 'https://k12comp.com', ip: 'rl-cors' });
  assert.equal(limited.status, 429); assert.equal(limited.headers.get('Access-Control-Allow-Origin'), 'https://k12comp.com');
});

test('B104 sister origin is bound to its own source: posted source ignored', async () => {
  for (const [origin, src] of SISTER) {
    for (const posted of [undefined, 'hazeydata', 'agentwebindex', SISTER.find(([, s]) => s !== src)[1]]) {
      const env = await setup(); const m = beehiivMock();
      const f = { email: email('bind104') }; if (posted !== undefined) f.source = posted;
      assert.deepEqual(await (await post(env, m, f, { origin })).json(), { status: 'subscribed' });
      assert.equal(env.SIGNUPS.rows()[0].source, src);
      assert.deepEqual(m.calls[1].body, { tags: [src] });
    }
  }
});

test('B104 hazeydata.ai origin keeps free source choice (tag follows exact source)', async () => {
  const env = await setup(); const m = beehiivMock();
  await post(env, m, { email: email('hdsrc'), source: 'agentwebindex' }, { origin: 'https://www.hazeydata.ai' });
  assert.deepEqual(m.calls[1].body, { tags: ['agentwebindex'] });
});

test('B104 non-POST/OPTIONS methods still 405 and Allow lists OPTIONS', async () => {
  const res = await handleSubscribe(req({}, { method: 'GET' }), await setup(), {});
  assert.equal(res.status, 405); assert.equal(res.headers.get('Allow'), 'POST, OPTIONS');
});
