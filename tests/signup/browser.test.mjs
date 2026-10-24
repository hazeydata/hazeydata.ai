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
import { onRequest as exportRoute } from '../../functions/api/signups/[file].js';
import { MESSAGES } from '../../assets/signup/signup-config.js';
import { ENV, EXPORT_TOKEN, ORIGIN, email, beehiivMock, captureLogs, assertCleanLogs, makeD1 } from './helpers.mjs';

const tools = process.env.SIGNUP_TEST_TOOLS;
const req = tools ? createRequire(join(tools, 'package.json')) : null;
const root = new URL('../..', import.meta.url).pathname;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json', '.woff2': 'font/woff2' };

let browser, ip = 'test-ip-0', db, env;
const blocked = [];
const used = [];
const logs = captureLogs();

async function serveStatic(url) {
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith('/')) p += 'index.html';
  try {
    const body = await readFile(join(root, p));
    return new Response(body, { status: 200, headers: { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream' } });
  } catch {
    return new Response(await readFile(join(root, '404.html')), { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}
const ASSETS = { fetch: (r) => serveStatic(new URL(r.url)) };

async function route(r, { timeoutMs }) {
  const url = new URL(r.url());
  const headers = new Headers(r.headers());
  headers.set('CF-Connecting-IP', ip);
  const request = new Request(url, { method: r.method(), headers, body: ['GET', 'HEAD'].includes(r.method()) ? undefined : r.postData() });
  if (url.pathname === '/api/subscribe') return handleSubscribe(request, env, { fetch: beehiivMock(), timeoutMs });
  const m = /^\/api\/signups\/([^/]+)$/.exec(url.pathname);
  if (m) return exportRoute({ request, env: { ...env, ASSETS, EXPORT_TOKEN }, params: { file: m[1] } });
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
  env = { ...ENV, SIGNUPS: await makeD1() };
  if (!req) return;
  const puppeteer = req('puppeteer-core');
  browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
});
after(async () => { await browser?.close(); logs.restore(); assertCleanLogs(assert, logs.lines, used); });

// [expected status, mock kind]. R2: Beehiiv failures still show success (row stays pending);
// only a store-write failure ('storefail') shows error.
const CASES = [
  ['subscribed', 'new'], ['already_subscribed', 'dupe'], ['invalid_email', 'bad'], ['rate_limited', 'new'],
  ['error', 'storefail'], ['subscribed', 'fail500'], ['subscribed', 'slow'], ['subscribed', 'network'],
  ['subscribed', 'badkey'], ['subscribed', 'hp'],
];

for (const js of [true, false]) {
  for (const [want, kind] of CASES) {
    test(`[${js ? 'js' : 'nojs'}] ${want} via ${kind}`, { skip: !req && 'no SIGNUP_TEST_TOOLS' }, async () => {
      _resetMemoryLimiter();
      ip = `test-ip-${Math.random().toString(36).slice(2)}`;
      db = await makeD1({ failWrites: kind === 'storefail' });
      env = { ...ENV, SIGNUPS: db };
      if (want === 'rate_limited') for (let i = 0; i < 5; i++) await overLimit({}, ip);
      const addrDupe = email(`dupe${js ? 'j' : 'n'}`);
      if (kind === 'dupe') await db.prepare("INSERT INTO signups (email, source, created_at) VALUES (?, 'hazeydata', '2026-10-24T00:00:00.000Z')").bind(addrDupe).run();
      const page = await newPage({ js });
      const addr = kind === 'bad' ? 'not-an-email' : email(`${kind}${js ? 'j' : 'n'}`);
      const before = kind === 'storefail' ? 0 : db.rows().length;
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
      if (kind !== 'storefail') {
        const stored = want === 'subscribed' && kind !== 'hp' ? 1 : 0;
        assert.equal(db.rows().length - before, stored, 'rows added'); // AC21 / AC6 / AC25
        if (['fail500', 'slow', 'network', 'badkey'].includes(kind)) assert.equal(db.rows().at(-1).status, 'pending'); // AC23
      }
      await page.close();
    });
  }
}

test('AC26 export 404 is byte-identical to an unknown path (real 404.html)', { skip: !req && 'no SIGNUP_TEST_TOOLS' }, async () => {
  env = { ...ENV, SIGNUPS: await makeD1() };
  const page = await newPage({ js: true });
  const grab = (path, auth) => page.evaluate(async (p, a) => {
    const r = await fetch(p, { headers: a ? { Authorization: a } : {} });
    return [r.status, r.headers.get('content-type'), await r.text()];
  }, path, auth);
  const unknown = await grab('/no-such-page-hd');
  assert.equal(unknown[0], 404);
  assert.deepEqual(await grab('/api/signups/export.csv'), unknown);
  assert.deepEqual(await grab('/api/signups/export.csv', 'Bearer wrong'), unknown);
  const ok = await grab('/api/signups/export.csv', `Bearer ${EXPORT_TOKEN}`);
  assert.equal(ok[0], 200); assert.ok(ok[2].startsWith('email,source,utm_source,utm_medium,utm_campaign,created_at'));
  await page.close();
});

test('[js] AC13 button disables while in flight', { skip: !req && 'no SIGNUP_TEST_TOOLS' }, async () => {
  _resetMemoryLimiter(); ip = 'test-ip-btn'; env = { ...ENV, SIGNUPS: await makeD1() };
  const page = await newPage({ js: true, timeoutMs: 800 });
  await submit(page, email('slowbtn'));
  await page.waitForFunction(() => document.querySelector('.hd-signup-button').disabled);
  await page.waitForFunction(() => !document.querySelector('.hd-signup-button').disabled, { timeout: 5000 });
  assert.equal((await statusText(page))[0], 'subscribed');
  await page.close();
});

test('AC11/AC17 whole page makes 0 requests outside hazeydata.ai; renders; self-hosted fonts load', { skip: !req && 'no SIGNUP_TEST_TOOLS' }, async () => {
  const html = await readFile(join(root, 'index.html'), 'utf8');
  assert.ok(!/beehiiv/i.test(html), 'beehiiv reference in index.html');
  const form = await readFile(join(root, 'assets/signup/signup-form.html'), 'utf8');
  assert.ok(!/https?:\/\//.test(form.replace(/<!--.*?-->/s, '')), 'absolute URL in partial');
  assert.ok(!blocked.some((o) => /beehiiv/.test(o)), `beehiiv requested: ${blocked}`);
  assert.ok(!/fonts\.(googleapis|gstatic)\.com/.test(html), 'Google Fonts link in index.html');
  const css = await readFile(join(root, 'hazeydata-b.css'), 'utf8');
  assert.ok(!/https?:\/\//.test(css.split('\n')[0]), 'remote @import in hazeydata-b.css');
  blocked.length = 0;
  const page = await newPage({ js: true });
  await page.evaluate(() => document.fonts.ready);
  const box = await page.$eval('form.hd-signup', (f) => f.getBoundingClientRect().height);
  assert.ok(box > 40);
  const fonts = await page.evaluate(() => ['Inter', 'Space Grotesk'].map((f) => document.fonts.check(`600 16px "${f}"`)));
  assert.deepEqual(fonts, [true, true], 'self-hosted fonts loaded');
  const h1 = await page.$eval('h1', (el) => getComputedStyle(el).fontFamily);
  assert.match(h1, /Space Grotesk/);
  assert.deepEqual(blocked, [], `third-party requests: ${blocked}`);
  await page.close();
});

async function renderedFonts(page, selectors) {
  const cdp = await page.createCDPSession();
  await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
  const { root: doc } = await cdp.send('DOM.getDocument');
  const out = {};
  for (const sel of selectors) {
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: doc.nodeId, selector: sel });
    assert.ok(nodeId, `missing ${sel}`);
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    out[sel] = fonts.map((f) => f.familyName);
  }
  await cdp.detach();
  return out;
}

for (const [width, subscribe] of [[1440, '.hub-nav-links a.nav-subscribe'], [390, 'a.nav-subscribe-mobile']]) {
  test(`AC11 rendered fonts @${width}: nav links + Subscribe in Inter, h1 in Space Grotesk, third parties blocked`, { skip: !req && 'no SIGNUP_TEST_TOOLS' }, async () => {
    blocked.length = 0;
    const page = await newPage({ js: true, width });
    await page.evaluate(() => document.fonts.ready);
    if (width === 390) await page.click('#hubHamburger');
    const sel = ['.hub-nav-links a[href="#projects"]', '.hub-nav-links a[href="#about"]', subscribe, 'h1'];
    const got = await renderedFonts(page, sel);
    // Platform family names of the variable fonts' default instance, e.g. "Space Grotesk Light"; every glyph must come from it.
    const only = (fam, re) => fam.length > 0 && fam.every((f) => re.test(f));
    for (const s of sel.slice(0, 3)) assert.ok(only(got[s], /^Inter\b/), `${s} rendered with ${got[s]}`);
    assert.ok(only(got.h1, /^Space Grotesk\b/), `h1 rendered with ${got.h1}`);
    for (const s of sel.slice(0, 3)) {
      const fam = await page.$eval(s, (el) => getComputedStyle(el).fontFamily);
      assert.match(fam, /sans-serif\s*$/, `${s} font stack lacks sans-serif fallback: ${fam}`);
    }
    assert.deepEqual(blocked, [], `third-party requests: ${blocked}`);
    await page.close();
  });
}

test('AC15 a11y: label, type/autocomplete, aria-live, honeypot hidden, axe 0 violations, focus ring', { skip: !req && 'no SIGNUP_TEST_TOOLS' }, async () => {
  const page = await newPage({ js: true });
  const facts = await page.evaluate(() => {
    const i = document.querySelector('#hd-signup-email');
    const l = document.querySelector('label[for="hd-signup-email"]');
    const s = document.querySelector('[data-signup-status]');
    const hp = document.querySelector('.hd-signup-hp');
    const hpi = document.querySelector('#hd-signup-website');
    return { labelText: l.textContent, buttonText: document.querySelector('.hd-signup-button').textContent, placeholder: i.placeholder, label: !!l && l.offsetHeight > 0, type: i.type, ac: i.autocomplete, live: s.getAttribute('aria-live'), hpHidden: hp.getAttribute('aria-hidden'), hpTab: hpi.tabIndex };
  });
  assert.deepEqual(facts, { labelText: 'Your email', buttonText: 'Sign me up', placeholder: 'you@example.com', label: true, type: 'email', ac: 'email', live: 'polite', hpHidden: 'true', hpTab: -1 });
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
