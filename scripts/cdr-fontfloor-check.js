#!/usr/bin/env node
/*
 * CDR 13px font-floor check (hazeydata.ai #36 follow-up).
 *
 * Usage:
 *   node scripts/cdr-fontfloor-check.js [--base URL | --root DIR] [--widths 390,1440] [--overflow 320,390] [--json out.json] [--min 13]
 *
 *   --base URL     site to test (default https://hazeydata.ai)
 *   --root DIR     instead of --base: serve DIR (repo root) with `python3 -m http.server` on a free port, stopped on exit
 *   --widths       viewport widths for the font-size floor (default 390,1440)
 *   --overflow     also fail if the page or the active slide overflows horizontally at these widths (default: off)
 *   --json FILE    write every miss / overflow as JSON
 *   --min PX       floor (default 13)
 *
 * Every slide of every deck is made active in turn (active class toggled; same state as the deck's goTo()),
 * in EN and FR (the deck's own setLang()). Every visible element that owns a non-blank text node is measured.
 * Exit code: 0 = no misses (and no overflow if --overflow), 1 = misses/overflow, 2 = runtime error.
 * Env: CHROME (default /usr/bin/google-chrome); CDR_TEST_TOOLS = dir with node_modules/puppeteer-core (as for tests/cdr/),
 *      otherwise puppeteer-core is resolved next to this file or from the cwd.
 */
const path = require('path');
const { spawn } = require('child_process');
const net = require('net');
const puppeteer = require(require.resolve('puppeteer-core', { paths: [process.env.CDR_TEST_TOOLS, __dirname, process.cwd()].filter(Boolean) }));

const PAGES = ['/cdr/', '/cdr/pitch.html', '/cdr/funding-pitch.html', '/cdr/pilot-pitch.html', '/cdr/project-plan.html'];
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const MIN = parseFloat(opt('--min', '13'));
const WIDTHS = opt('--widths', '390,1440').split(',').map(Number);
const OVERFLOW = opt('--overflow', '') ? opt('--overflow').split(',').map(Number) : [];
const JSON_OUT = opt('--json', '');
const ROOT = opt('--root', '');
let BASE = opt('--base', 'https://hazeydata.ai').replace(/\/$/, '');

const NO_MOTION = '*,*::before,*::after{transition:none!important;animation-delay:0s!important;animation-duration:1ms!important}';

function freePort() {
  return new Promise((res, rej) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); });
}
async function waitUp(url) {
  for (let i = 0; i < 50; i++) { try { const r = await fetch(url); if (r.ok) return; } catch (e) {} await new Promise(r => setTimeout(r, 100)); }
  throw new Error('server did not start: ' + url);
}

// Runs in the page: list visible text owners under the floor, scoped to slide `idx` (or the non-slide chrome when idx === -1, or everything when no slides).
function measure({ idx, min }) {
  const slides = [...document.querySelectorAll('.slide')];
  const desc = (n) => n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + [...n.classList].filter(c => c !== 'active' && c !== 'visible').map(c => '.' + c).join('') + (n.dataset && n.dataset.lang ? `[data-lang=${n.dataset.lang}]` : '');
  const sel = (el) => { const parts = []; let n = el; while (n && n !== document.body && parts.length < 4) { parts.unshift(desc(n)); if (n.classList.contains('slide')) break; n = n.parentElement; } return parts.join(' > '); };
  const media = (r) => !r.media || matchMedia(r.media.mediaText || r.conditionText).matches;
  const rules = [];
  const walk = (list) => { for (const r of list) { if (r.cssRules && r.media) { if (media(r)) walk(r.cssRules); } else if (r.selectorText && r.style && r.style.fontSize) rules.push(r); } };
  for (const ss of document.styleSheets) { try { walk(ss.cssRules); } catch (e) {} }
  const own = (n) => {
    if (n.style && n.style.fontSize) return { kind: 'inline', decl: 'style="font-size:' + n.style.fontSize + '"' };
    let hit = null, imp = null;
    for (const r of rules) { try { if (n.matches(r.selectorText)) { hit = r; if (r.style.getPropertyPriority('font-size')) imp = r; } } catch (e) {} }
    const r = imp || hit; return r ? { kind: 'rule', decl: r.selectorText + '{font-size:' + r.style.fontSize + (r.style.getPropertyPriority('font-size') ? '!important' : '') + '}' } : null;
  };
  const source = (el) => { for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const o = own(n); if (o) return Object.assign(o, n === el ? {} : { inheritedFrom: desc(n) }); } return { kind: 'default' }; };
  const out = [];
  const scope = slides.length ? (idx >= 0 ? [slides[idx]] : [document.body]) : [document.body];
  for (const root of scope) {
    for (const el of root.querySelectorAll('*')) {
      if (idx === -1 && el.closest('.slide')) continue;
      if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG'].includes(el.tagName)) continue;
      const txt = [...el.childNodes].filter(c => c.nodeType === 3).map(c => c.textContent).join('').replace(/\s+/g, ' ').trim();
      if (!txt) continue;
      if (!el.getClientRects().length) continue;
      if (el.checkVisibility && !el.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true })) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < min - 0.005) out.push({ selector: sel(el), size: Math.round(fs * 100) / 100, text: txt.slice(0, 60), source: source(el) });
    }
  }
  return out;
}

function overflowOf(idx) {
  const vw = document.documentElement.clientWidth;
  const res = [];
  if (document.documentElement.scrollWidth > vw + 1) res.push({ what: 'document', scrollWidth: document.documentElement.scrollWidth, vw });
  const s = idx >= 0 ? document.querySelectorAll('.slide')[idx] : null;
  if (s && s.scrollWidth > s.clientWidth + 1) {
    // name the widest offenders (ignoring descendants of the allowed scroll-in-place tables)
    const sr = s.getBoundingClientRect();
    const off = [...s.querySelectorAll('*')].filter(e => { if (e.closest('.compare-table,.rev-table,.fund-table') && !e.matches('.compare-table,.rev-table,.fund-table')) return false; const r = e.getBoundingClientRect(); return r.width && r.right > sr.right + 1; })
      .slice(0, 3).map(e => e.tagName.toLowerCase() + [...e.classList].map(c => '.' + c).join(''));
    res.push({ what: 'slide', scrollWidth: s.scrollWidth, clientWidth: s.clientWidth, offenders: off });
  }
  return res;
}

(async () => {
  let server = null, browser = null, code = 2;
  try {
    if (ROOT) {
      const port = await freePort();
      server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: path.resolve(ROOT), stdio: 'ignore' });
      BASE = `http://127.0.0.1:${port}`;
      await waitUp(BASE + '/cdr/');
    }
    browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'] });
    const page = await browser.newPage();
    const misses = [], overflows = [];
    const widths = [...new Set([...WIDTHS, ...OVERFLOW])].sort((a, b) => a - b);
    for (const p of PAGES) {
      for (const w of widths) {
        const doFont = WIDTHS.includes(w), doOver = OVERFLOW.includes(w);
        await page.setViewport({ width: w, height: w < 800 ? 844 : 900 });
        await page.goto(BASE + p, { waitUntil: 'networkidle0', timeout: 60000 });
        await page.addStyleTag({ content: NO_MOTION });
        await page.evaluate(() => document.fonts && document.fonts.ready);
        const info = await page.evaluate(() => ({ slides: document.querySelectorAll('.slide').length, lang: typeof setLang === 'function' }));
        const langs = info.lang ? ['en', 'fr'] : ['en'];
        for (const lang of langs) {
          if (info.lang) await page.evaluate(l => setLang(l), lang);
          const idxs = info.slides ? [-1, ...Array.from({ length: info.slides }, (_, i) => i)] : [-2];
          for (const idx of idxs) {
            if (idx >= 0) {
              await page.evaluate(i => { document.querySelectorAll('.slide').forEach((s, j) => { s.classList.remove('exit'); s.classList.toggle('active', j === i); }); if (typeof current !== 'undefined') current = i; }, idx);
              await new Promise(r => setTimeout(r, 60));
            }
            const slide = idx === -2 ? 'page' : idx === -1 ? 'chrome (nav/lang bar)' : `slide ${idx + 1}/${info.slides}`;
            if (doFont) for (const m of await page.evaluate(measure, { idx: idx === -2 ? 0 : idx, min: MIN })) misses.push({ page: p, width: w, lang, slide, ...m });
            if (doOver && idx !== -1) for (const o of await page.evaluate(overflowOf, idx)) overflows.push({ page: p, width: w, lang, slide, ...o });
          }
        }
      }
    }
    // group: page + selector + source -> sizes per width, slides, langs
    const groups = new Map();
    for (const m of misses) {
      const k = [m.page, m.selector, JSON.stringify(m.source), m.text].join('|');
      const g = groups.get(k) || { page: m.page, selector: m.selector, source: m.source, text: m.text, sizes: {}, slides: new Set(), langs: new Set() };
      g.sizes[m.width] = m.size; g.slides.add(m.slide); g.langs.add(m.lang); groups.set(k, g);
    }
    const rows = [...groups.values()];
    console.log(`base=${BASE} min=${MIN}px font-widths=${WIDTHS.join(',')}${OVERFLOW.length ? ' overflow-widths=' + OVERFLOW.join(',') : ''}`);
    console.log(`font-floor misses: ${misses.length} (element×slide×lang×width), ${rows.length} distinct elements`);
    const minSize = misses.reduce((a, m) => Math.min(a, m.size), Infinity);
    if (misses.length) console.log(`smallest: ${minSize}px`);
    for (const r of rows) {
      const src = r.source.kind === 'default' ? 'default' : r.source.decl + (r.source.inheritedFrom ? ' (inherited from ' + r.source.inheritedFrom + ')' : '');
      console.log(`MISS ${r.page} | ${[...r.slides].join(', ')} | ${[...r.langs].join('+')} | ${WIDTHS.map(w => w + ':' + (r.sizes[w] ?? '-')).join(' ')} | ${r.selector} | ${src} | "${r.text}"`);
    }
    if (OVERFLOW.length) {
      console.log(`horizontal overflow: ${overflows.length}`);
      for (const o of overflows) console.log(`OVERFLOW ${o.page} | ${o.slide} | ${o.lang} | ${o.width} | ${o.what} ${o.scrollWidth}>${o.clientWidth || o.vw} ${o.offenders ? o.offenders.join(' ') : ''}`);
    }
    if (JSON_OUT) require('fs').writeFileSync(JSON_OUT, JSON.stringify({ base: BASE, min: MIN, misses, grouped: rows.map(r => ({ ...r, slides: [...r.slides], langs: [...r.langs] })), overflows }, null, 1));
    code = misses.length || overflows.length ? 1 : 0;
    console.log(code ? 'FAIL' : 'PASS');
  } catch (e) {
    console.error('ERROR', e && e.stack || e); code = 2;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) server.kill('SIGTERM');
  }
  process.exit(code);
})();
