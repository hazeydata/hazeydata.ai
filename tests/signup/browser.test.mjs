// HD-SIGNUP-001 Phase 2/3 in headless Chrome (AC11-13, AC15, AC17, AC18, AC20 JS on/off).
// Every request is intercepted: https://hazeydata.ai/* is served from this checkout through the real
// middleware and /api/subscribe handler (Beehiiv mocked); every other origin is blocked and recorded.
// Needs puppeteer-core + axe-core: set SIGNUP_TEST_TOOLS=<dir with node_modules>, CHROME=<chrome path>.
// Optional SIGNUP_SHOTS=<dir> writes 390 / 1440 screenshots.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { handleSubscribe, _resetMemoryLimiter, overLimit } from '../../functions/api/subscribe.js';
import { onRequest as middleware } from '../../functions/_middleware.js';
import { MESSAGES } from '../../assets/signup/signup-config.js';
import { ENV, ORIGIN, email, beehiivMock, captureLogs, assertCleanLogs } from './helpers.mjs';

const tools = process.env.SIGNUP_TEST_TOOLS;
const req = tools ? createRequire(join(tools, 'package.json')) : null;
const root = new URL('../..', import.meta.url).pathname;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json' };

let browser, ip = '192.0.2.1';
const blocked = [];
const used = [];
const logs = captureLogs();

async function serveStatic(url) {
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith('/')) p += 'index.html';
  try {
    const body = await readFile(join(root, p));
    return new Response(body, { status: 200, headers: { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream' } });
  } catch { return new Response('not found', { status: 404, headers: { 'Content-Type': 'text/plain' } }); }
}

async function route(r, { timeoutMs }) {
  const url = new URL(r.url());
  const headers = new Headers(r.headers());
  headers.set('CF-Connecting-IP', ip);
  const request = new Request(url, { method: r.method(), headers, body: ['GET', 'HEAD'].includes(r.method()) ? undefined : r.postData() });
  if (url.pathname === '/api/subscribe') return handleSubscribe(request, ENV, { fetch: beehiivMock(), timeoutMs });
  return middleware({ request, env: {}, next: () => serveStatic(url) });
}

async function newPage({ js = true, width = 1440, timeoutMs = 300 } = {}) {
  const page = await browser.newPage();
  await page.setJavaScriptEnabled(js);
  await page.setViewport({ width, height: 900 });
  await page.setRequestInterception(true);
  page.on('request', async (r) => {
    if (!r.url().startsWith(ORIGIN + '/')) { if (!r.url().startsWith('data:')) blocked.push(new URL(r.url()).origin); return r.abort('blockedbyclient'); }
    const res = await route(r, { timeoutMs });
    const h = Object.fromEntries(res.headers);
    if (res.status === 303) return r.respond({ status: 303, headers: h });
    return r.respond({ status: res.status, headers: h, body: Buffer.from(await res.arrayBuffer()) });
  });
  await page.goto(`${ORIGIN}/`, { waitUntil: 'load' });
  return page;
}

async function submit(page, addr, { honeypot = false } = {}) {
  used.push(addr);
  await page.type('#hd-signup-email', addr);
  if (honeypot) await page.$eval('#hd-signup-website', (el) => { el.value = 'http://spam'; });
  await page.focus('#hd-signup-email');
  await page.keyboard.press('Enter'); // keyboard-operable submit
}

const statusText = (page) => page.$eval('[data-signup-status]', (el) => [el.dataset.state, el.textContent]);

before(async () => {
  if (!req) return;
  const puppeteer = req('puppeteer-core');
  browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
});
after(async () => { await browser?.close(); logs.restore(); assertCleanLogs(assert, logs.lines, used); });

const CASES = [
  ['subscribed', 'new'], ['already_subscribed', 'old'], ['invalid_email', 'bad'],
  ['rate_limited', 'new'], ['error', 'fail500'], ['error', 'slow'], ['error', 'network'], ['subscribed', 'hp'],
];

for (const js of [true, false]) {
  for (const [want, kind] of CASES) {
    test(`[${js ? 'js' : 'nojs'}] ${want} via ${kind}`, { skip: !req && 'no SIGNUP_TEST_TOOLS' }, async () => {
      _resetMemoryLimiter();
      ip = `192.0.2.${Math.floor(Math.random() * 250) + 1}`;
      if (want === 'rate_limited') for (let i = 0; i < 5; i++) await overLimit({}, ip);
      const page = await newPage({ js });
      const addr = kind === 'bad' ? 'not-an-email' : email(`${kind}${js ? 'j' : 'n'}`);
      if (js) {
        await submit(page, addr, { honeypot: kind === 'hp' });
        await page.waitForFunction(() => document.querySelector('[data-signup-status]').dataset.state);
        assert.equal(page.url(), `${ORIGIN}/`, 'no reload with JS'); // AC13
      } else {
        await Promise.all([page.waitForNavigation(), submit(page, addr, { honeypot: kind === 'hp' })]);
        assert.equal(new URL(page.url()).searchParams.get('signup'), want); // AC12
      }
      assert.deepEqual(await statusText(page), [want, MESSAGES[want]]);
      assert.ok(await page.$('#hd-signup-email'), 'page stays usable'); // AC18
      await page.close();
    });
  }
}

test('[js] AC13 button disables while in flight', { skip: !req && 'no SIGNUP_TEST_TOOLS' }, async () => {
  _resetMemoryLimiter(); ip = '192.0.2.251';
  const page = await newPage({ js: true, timeoutMs: 800 });
  await submit(page, email('slowbtn'));
  await page.waitForFunction(() => document.querySelector('.hd-signup-button').disabled);
  await page.waitForFunction(() => !document.querySelector('.hd-signup-button').disabled, { timeout: 5000 });
  assert.equal((await statusText(page))[0], 'error');
  await page.close();
});

test('AC11/AC17 page renders with all third-party origins blocked; no Beehiiv in markup', { skip: !req && 'no SIGNUP_TEST_TOOLS' }, async () => {
  const html = await readFile(join(root, 'index.html'), 'utf8');
  assert.ok(!/beehiiv/i.test(html), 'beehiiv reference in index.html');
  const form = await readFile(join(root, 'assets/signup/signup-form.html'), 'utf8');
  assert.ok(!/https?:\/\//.test(form.replace(/<!--.*?-->/s, '')), 'absolute URL in partial');
  assert.ok(!blocked.some((o) => /beehiiv/.test(o)), `beehiiv requested: ${blocked}`);
  const page = await newPage({ js: true });
  const box = await page.$eval('form.hd-signup', (f) => f.getBoundingClientRect().height);
  assert.ok(box > 40);
  console.error = () => {};
  await page.close();
});

test('AC15 a11y: label, type/autocomplete, aria-live, honeypot hidden, axe 0 violations, focus ring', { skip: !req && 'no SIGNUP_TEST_TOOLS' }, async () => {
  const page = await newPage({ js: true });
  const facts = await page.evaluate(() => {
    const i = document.querySelector('#hd-signup-email');
    const l = document.querySelector('label[for="hd-signup-email"]');
    const s = document.querySelector('[data-signup-status]');
    const hp = document.querySelector('.hd-signup-hp');
    const hpi = document.querySelector('#hd-signup-website');
    return { label: !!l && l.offsetHeight > 0, type: i.type, ac: i.autocomplete, live: s.getAttribute('aria-live'), hpHidden: hp.getAttribute('aria-hidden'), hpTab: hpi.tabIndex };
  });
  assert.deepEqual(facts, { label: true, type: 'email', ac: 'email', live: 'polite', hpHidden: 'true', hpTab: -1 });
  await page.addScriptTag({ path: req.resolve('axe-core/axe.min.js') });
  const res = await page.evaluate(() => axe.run('form.hd-signup', { runOnly: ['wcag2a', 'wcag2aa'] }));
  assert.deepEqual(res.violations.map((v) => v.id), []);
  await page.keyboard.press('Tab');
  let guard = 0;
  while (guard++ < 60 && !(await page.evaluate(() => document.activeElement?.id === 'hd-signup-email'))) await page.keyboard.press('Tab');
  assert.ok(guard < 60, 'email reachable by keyboard');
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
  assert.notEqual(outline, 'none');
  await page.close();
});

test('screenshots at 390 and 1440 with third parties blocked', { skip: (!req || !process.env.SIGNUP_SHOTS) && 'no SIGNUP_SHOTS' }, async () => {
  for (const width of [390, 1440]) {
    const page = await newPage({ js: true, width });
    await page.$eval('#signup', (el) => el.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: join(process.env.SIGNUP_SHOTS, `signup-${width}.png`) });
    await page.close();
  }
});
