// CDR decks at 390px and 320px: no element on ANY slide (EN and FR) may extend past the viewport.
// body{overflow:hidden} clips overflow, so documentElement.scrollWidth alone is not enough:
// each visible element's (on every slide, nav bar included) getBoundingClientRect().right is checked against 390 (content inside
// an overflow-x:auto/scroll container is exempt, since it is scrollable).
// Needs puppeteer-core: CDR_TEST_TOOLS=<dir with node_modules> (or SIGNUP_TEST_TOOLS), CHROME=<chrome path>.
// Optional: CDR_ROOT=<site checkout> (default: this repo), CDR_EVIDENCE=<dir> for screenshots + JSON.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, extname } from 'node:path';

const tools = process.env.CDR_TEST_TOOLS || process.env.SIGNUP_TEST_TOOLS;
const root = process.env.CDR_ROOT || new URL('../..', import.meta.url).pathname;
const EVID = process.env.CDR_EVIDENCE;
const WIDTHS = [390, 320];
// cdr-project-plan.html is the root-level copy of the project plan (CDR-RESTYLE loads /cdr/deck.css there too).
const DECKS = ['cdr/project-plan.html', 'cdr/pitch.html', 'cdr/funding-pitch.html', 'cdr/pilot-pitch.html', 'cdr-project-plan.html'];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
let browser;

before(async () => {
  if (!tools) return;
  const puppeteer = createRequire(join(tools, 'package.json'))('puppeteer-core');
  browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new',
    args: ['--no-sandbox', '--font-render-hinting=none'], userDataDir: process.env.CDR_PROFILE });
});
after(async () => { if (browser) await browser.close(); });

async function measure(page, lang, i, W) {
  return page.evaluate(async (lang, W, i) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    document.body.classList.toggle('lang-fr', lang === 'fr');
    const slides = [...document.querySelectorAll('.slide')];
    // .slide itself is overflow-y:auto (so overflow-x computes to auto); sideways scroll of a slide is a bug, so only inner scrollers exempt.
    const scrollable = (e) => { for (let a = e.parentElement; a && a !== document.body && !a.classList.contains('slide'); a = a.parentElement) { const o = getComputedStyle(a).overflowX; if (o === 'auto' || o === 'scroll') return true; } return false; };
      slides.forEach((s, j) => { s.classList.remove('exit'); s.classList.toggle('active', j === i); });
      await sleep(800);
      const bad = [];
      let maxRight = 0;
      for (const e of [...slides[i].querySelectorAll('*'), ...document.querySelectorAll('.nav-bar, .nav-bar *')]) {
        const b = e.getBoundingClientRect();
        if (b.width === 0 || b.height === 0 || getComputedStyle(e).visibility === 'hidden') continue;
        if (scrollable(e)) continue;
        maxRight = Math.max(maxRight, b.right);
        if (b.right > W + 0.5) bad.push({ el: e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).join('.') : ''), right: Math.round(b.right), text: (e.textContent || '').trim().slice(0, 40) });
      }
      const lato = [...slides[i].querySelectorAll('*')].filter((e) => /lato/i.test(getComputedStyle(e).fontFamily)).length;
      // On phones every column grid stacks to one track, in EN and FR (FR rules must not re-force columns).
      const multiCol = [...slides[i].querySelectorAll('.two-col, .three-col, .four-col')].filter((g) => g.getBoundingClientRect().width && getComputedStyle(g).gridTemplateColumns.trim().split(/\s+/).length > 1).length;
      const lt = document.querySelector('.lang-toggle');
      const slideSW = slides[i].scrollWidth - slides[i].clientWidth;
      const ltClipped = lt ? lt.scrollWidth > lt.clientWidth + 1 : false;
      return ({ slide: i, docScrollWidth: document.documentElement.scrollWidth, maxRight: Math.round(maxRight), slideScrollExcess: slideSW, overflowing: bad.length, langToggleClipped: ltClipped, latoElements: lato, multiCol, worst: bad.sort((a, b) => b.right - a.right).slice(0, 5) });
  }, lang, W, i);
}

async function open(path, W) {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: 844 });
  await page.setRequestInterception(true);
  page.on('request', async (r) => {
    const u = new URL(r.url());
    if (u.hostname !== 'cdr.test') return r.abort();
    let p = decodeURIComponent(u.pathname); if (p.endsWith('/')) p += 'index.html';
    try { r.respond({ status: 200, contentType: TYPES[extname(p)] || 'application/octet-stream', body: await readFile(join(root, p)) }); }
    catch { r.respond({ status: 404, body: '' }); }
  });
  await page.goto(`http://cdr.test/${path}`, { waitUntil: 'load' });
  return page;
}

for (const W of WIDTHS) {
// Landing page /cdr/ (CDR-RESTYLE): fits 390 in full-page layout, CTA sits above the stats in the DOM, no Lato.
test(`cdr/ landing fits ${W}px, CTA above stats`, { skip: !tools && 'set CDR_TEST_TOOLS' }, async () => {
  const page = await open('cdr/', W);
  await new Promise((r) => setTimeout(r, 500));
  const s = await page.evaluate((W) => {
    const bad = [];
    for (const e of document.querySelectorAll('body *')) {
      if (e.closest('.cdr-ambient')) continue;
      const b = e.getBoundingClientRect();
      if (b.width === 0 || b.height === 0 || getComputedStyle(e).visibility === 'hidden') continue;
      if (b.right > W + 0.5) bad.push(e.tagName.toLowerCase() + '.' + (typeof e.className === 'string' ? e.className : '') + ' ' + Math.round(b.right));
    }
    const cta = document.querySelector('.cdr-hero-cta'), stats = document.querySelector('.cdr-crisis-stats');
    return { docScrollWidth: document.documentElement.scrollWidth, bad: bad.slice(0, 5),
      ctaBeforeStats: !!(cta && stats && (cta.compareDocumentPosition(stats) & Node.DOCUMENT_POSITION_FOLLOWING)),
      lato: [...document.querySelectorAll('body *')].filter((e) => /lato/i.test(getComputedStyle(e).fontFamily)).length };
  }, W);
  if (EVID) { await mkdir(EVID, { recursive: true }); await page.screenshot({ path: join(EVID, `cdr_landing_${W}.png`), fullPage: true }); await writeFile(join(EVID, `cdr_landing_${W}.json`), JSON.stringify(s, null, 1)); }
  await page.close();
  assert.deepEqual(s, { docScrollWidth: W, bad: [], ctaBeforeStats: true, lato: 0 });
});

for (const deck of DECKS) {
  test(`${deck} fits ${W}px on every slide (EN+FR)`, { skip: !tools && 'set CDR_TEST_TOOLS' }, async () => {
    const page = await open(deck, W);
    const out = {};
    if (EVID) await mkdir(EVID, { recursive: true });
    const fails = [];
    for (const lang of ['en', 'fr']) {
      out[lang] = [];
      const n = await page.evaluate(() => document.querySelectorAll('.slide').length);
      for (let i = 0; i < n; i++) {
        const s = await measure(page, lang, i, W);
        out[lang].push(s);
        if (EVID) await page.screenshot({ path: join(EVID, `${deck.replace(/\W+/g, '_')}_${W}_${lang}_s${String(s.slide).padStart(2, '0')}.png`) });
        if (s.docScrollWidth > W || s.slideScrollExcess > 0 || s.overflowing || s.langToggleClipped || s.latoElements || s.multiCol) fails.push(`${lang} slide ${s.slide}: multiCol=${s.multiCol} maxRight=${s.maxRight} ${JSON.stringify(s.worst[0] || {})} toggleClipped=${s.langToggleClipped} lato=${s.latoElements}`);
      }
    }
    if (EVID) { await writeFile(join(EVID, `${deck.replace(/\W+/g, '_')}_${W}.json`), JSON.stringify(out, null, 1)); }
    await page.close();
    assert.deepEqual(fails, []);
  });
}
}
