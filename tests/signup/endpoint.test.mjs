// HD-SIGNUP-001 endpoint + export (AC3-7, AC9-10, AC19-29). Each signup case runs as JSON (JS on) and 303 (JS off).
// Needs SIGNUP_TEST_TOOLS (sql.js provides a real SQLite behind a D1-shaped adapter).
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { handleSubscribe, _resetMemoryLimiter } from '../../functions/api/subscribe.js';
import { onRequest as exportRoute, csvCell, toCsv, tokenMatches } from '../../functions/api/signups/[file].js';
import { injectSignupStatus } from '../../functions/_middleware.js';
import { SOURCES, MESSAGES, ALLOWED_ORIGINS, BEEHIIV_TIMEOUT_MS } from '../../assets/signup/signup-config.js';
import { ENV, EXPORT_TOKEN, ORIGIN, email, beehiivMock, captureLogs, assertCleanLogs, makeD1 } from './helpers.mjs';

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

  T('store missing table -> 502 error, Beehiiv not called, reason null (not in the enum)', async () => {
    const env = await setup({ d1: { noSchema: true } }); const m = beehiivMock();
    await expectStatus(await handleSubscribe(req({ email: email('notable') }, { json }), env, { fetch: m }), 'error', 502);
    assert.equal(m.calls.length, 0);
    assert.equal(lastLog().status, 'error'); assert.equal(lastLog().reason, null);
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

  T('AC24 store write fails -> error 502, no Beehiiv call', async () => {
    const env = await setup({ d1: { failWrites: true } });
    const m = beehiivMock();
    await expectStatus(await handleSubscribe(req({ email: email('storefail') }, { json }), env, { fetch: m }), 'error', 502);
    assert.equal(m.calls.length, 0);
    const noDb = { ...ENV };
    await expectStatus(await handleSubscribe(req({ email: email('nodb') }, { json }), noDb, { fetch: m }), 'error', 502);
    assert.equal(m.calls.length, 0);
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

test('AC8 default Beehiiv timeout is 5 s; AC9 origins exactly hazeydata.ai and www', () => {
  assert.equal(BEEHIIV_TIMEOUT_MS, 5000);
  assert.deepEqual(ALLOWED_ORIGINS, ['https://hazeydata.ai', 'https://www.hazeydata.ai']);
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
