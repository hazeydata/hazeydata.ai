// Shared test fixtures for HD-SIGNUP-001. Fake credentials only.
export const ENV = { BEEHIIV_API_KEY: 'REDACTED_TEST_KEY', BEEHIIV_PUB_ID: 'pub_00000000-0000-0000-0000-000000000000' };
export const EXPORT_TOKEN = 'REDACTED_EXPORT_TOKEN_FOR_TESTS';
export const ORIGIN = 'https://hazeydata.ai';
export const email = (local) => `${local}@hazeydata.invalid`;

// Beehiiv mock keyed on the email local part. Records every call.
export function beehiivMock(nowMs = Date.now()) {
  const calls = [];
  const fn = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, init, body });
    const local = body.email.split('@')[0];
    const ok = (created) => new Response(JSON.stringify({ data: { id: 'sub_00000000-0000-0000-0000-000000000000', email: body.email, status: 'active', created } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (local.startsWith('old')) return ok(Math.floor(nowMs / 1000) - 86400);
    if (local.startsWith('fail500')) return new Response('{"errors":[{"message":"boom"}]}', { status: 500 });
    if (local.startsWith('forbid')) return new Response('{}', { status: 403 });
    if (local.startsWith('badkey')) return new Response('{"errors":[{"message":"unauthorized"}]}', { status: 401 });
    if (local.startsWith('network')) throw new TypeError('fetch failed');
    if (local.startsWith('slow')) return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    return ok(Math.floor(nowMs / 1000));
  };
  fn.calls = calls;
  return fn;
}

export function captureLogs() {
  const lines = [];
  const orig = { log: console.log, error: console.error, warn: console.warn };
  for (const k of Object.keys(orig)) console[k] = (...a) => lines.push(a.join(' '));
  return { lines, restore: () => Object.assign(console, orig) };
}

export function assertCleanLogs(assert, lines, emails) {
  const blob = lines.join('\n');
  assert.ok(!blob.includes(ENV.BEEHIIV_API_KEY), 'key in logs');
  assert.ok(!blob.includes(ENV.BEEHIIV_PUB_ID), 'pub id in logs');
  assert.ok(!blob.includes(EXPORT_TOKEN), 'export token in logs');
  for (const e of emails) assert.ok(!blob.includes(e.split('@')[0] + '@'), 'email in logs');
  assert.ok(!/\b\d{1,3}(\.\d{1,3}){3}\b/.test(blob), 'ip in logs');
  for (const l of lines) {
    const o = JSON.parse(l);
    if (o.evt === 'export') assert.deepEqual(Object.keys(o).sort(), ['evt', 'status']);
    else assert.deepEqual(Object.keys(o).sort(), ['beehiiv_status', 'evt', 'reason', 'source', 'status']);
  }
}

// D1-compatible adapter over sql.js (SQLite in wasm), loaded from SIGNUP_TEST_TOOLS.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
let SQL;
export async function makeD1({ failWrites = false, noSchema = false } = {}) {
  if (!SQL) {
    const req = createRequire(join(process.env.SIGNUP_TEST_TOOLS, 'package.json'));
    SQL = await req('sql.js')();
  }
  const db = new SQL.Database();
  if (!noSchema) db.run(readFileSync(new URL('../../migrations/0001_signups.sql', import.meta.url), 'utf8'));
  const exec = (sql, args) => {
    if (failWrites && /^\s*(INSERT|UPDATE)\s+(INTO\s+)?signups/i.test(sql)) throw new Error('D1_ERROR: simulated');
    const st = db.prepare(sql); st.bind(args.map((a) => (a === undefined ? null : a)));
    const results = []; while (st.step()) results.push(st.getAsObject()); st.free();
    return { results, meta: { changes: db.getRowsModified() } };
  };
  const d1 = {
    prepare(sql) {
      let args = [];
      const s = {
        bind(...a) { args = a; return s; },
        async run() { return { success: true, ...exec(sql, args) }; },
        async first() { return exec(sql, args).results[0] ?? null; },
        async all() { return { success: true, ...exec(sql, args) }; },
      };
      return s;
    },
    rows: () => { const r = db.exec('SELECT * FROM signups ORDER BY id'); return r.length ? r[0].values.map((v) => Object.fromEntries(r[0].columns.map((c, i) => [c, v[i]]))) : []; },
    raw: db,
  };
  return d1;
}
