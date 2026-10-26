// CDR decks at 390px: no element on ANY slide (EN and FR) may extend past the viewport.
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
const W = 390;
const DECKS = ['cdr/project-plan.html', 'cdr/pitch.html', 'cdr/funding-pitch.html', 'cdr/pilot-pitch.html'];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
let browser;

before(async () => {
  if (!tools) return;
  const puppeteer = createRequire(join(tools, 'package.json'))('puppeteer-core');
  browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new',
    args: ['--no-sandbox', '--font-render-hinting=none'], userDataDir: process.env.CDR_PROFILE });
});
after(async () => { if (browser) await browser.close(); });

async function measure(page, lang, i) {
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
      const lt = document.querySelector('.lang-toggle');
      const slideSW = slides[i].scrollWidth - slides[i].clientWidth;
      const ltClipped = lt ? lt.scrollWidth > lt.clientWidth + 1 : false;
      return ({ slide: i, docScrollWidth: document.documentElement.scrollWidth, maxRight: Math.round(maxRight), slideScrollExcess: slideSW, overflowing: bad.length, langToggleClipped: ltClipped, worst: bad.sort((a, b) => b.right - a.right).slice(0, 5) });
  }, lang, W, i);
}

for (const deck of DECKS) {
  test(`${deck} fits 390px on every slide (EN+FR)`, { skip: !tools && 'set CDR_TEST_TOOLS' }, async () => {
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: 844 });
    await page.setRequestInterception(true);
    page.on('request', async (r) => {
      const u = new URL(r.url());
      if (u.hostname !== 'cdr.test') return r.abort();
      try { r.respond({ status: 200, contentType: TYPES[extname(u.pathname)] || 'application/octet-stream', body: await readFile(join(root, decodeURIComponent(u.pathname))) }); }
      catch { r.respond({ status: 404, body: '' }); }
    });
    await page.goto(`http://cdr.test/${deck}`, { waitUntil: 'load' });
    const out = {};
    if (EVID) await mkdir(EVID, { recursive: true });
    const fails = [];
    for (const lang of ['en', 'fr']) {
      out[lang] = [];
      const n = await page.evaluate(() => document.querySelectorAll('.slide').length);
      for (let i = 0; i < n; i++) {
        const s = await measure(page, lang, i);
        out[lang].push(s);
        if (EVID) await page.screenshot({ path: join(EVID, `${deck.replace(/\W+/g, '_')}_${lang}_s${String(s.slide).padStart(2, '0')}.png`) });
        if (s.docScrollWidth > W || s.slideScrollExcess > 1 || s.overflowing || s.langToggleClipped) fails.push(`${lang} slide ${s.slide}: maxRight=${s.maxRight} ${JSON.stringify(s.worst[0] || {})} toggleClipped=${s.langToggleClipped}`);
      }
    }
    if (EVID) { await writeFile(join(EVID, `${deck.replace(/\W+/g, '_')}.json`), JSON.stringify(out, null, 1)); }
    await page.close();
    assert.deepEqual(fails, []);
  });
}
