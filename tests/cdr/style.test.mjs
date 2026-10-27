// CDR-RESTYLE house-style guards: no Lato anywhere (source, network, computed), landing house button + h1 bar,
// WCAG AA contrast of every text and symbol glyph on every deck slide (EN+FR) at 1440x900, computed on the
// blended colour (opacity composed over the real background), colour tokens only (no literal colours outside :root),
// and #E3E9F0 borders on cards that sit on light slides.
// Needs puppeteer-core for the browser tests: CDR_TEST_TOOLS=<dir with node_modules>, CHROME=<chrome path>.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

const tools = process.env.CDR_TEST_TOOLS || process.env.SIGNUP_TEST_TOOLS;
const root = process.env.CDR_ROOT || new URL('../..', import.meta.url).pathname;
const DECKS = ['cdr/project-plan.html', 'cdr/pitch.html', 'cdr/funding-pitch.html', 'cdr/pilot-pitch.html', 'cdr-project-plan.html'];
const PAGES = ['cdr/', ...DECKS];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const LATO_URL = /\blato\b|fonts\.googleapis\.com|fonts\.gstatic\.com/i;
let browser;

// Colour maths shared by the in-page checks (installed as window.__cdr by open()). Chrome 155 serialises
// color-mix(in srgb, ..., transparent) as color(srgb r g b / a) with 0-1 channels, so parse handles both forms.
const HELPERS = `window.__cdr = (() => {
  const parse = (c) => {
    let m = c.match(/^rgba?\\(([^)]+)\\)/);
    if (m) { const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [r, g, b, a]; }
    m = c.match(/^color\\(srgb ([^)]+)\\)/);
    if (m) { const [r, g, b, a = 1] = m[1].split(/[ /]+/).filter(Boolean).map(Number); return [r * 255, g * 255, b * 255, a]; }
    return null;
  };
  const over = (top, bot) => [0, 1, 2].map((k) => top[k] * top[3] + bot[k] * (1 - top[3])).concat(1);
  const lum = (c) => { const v = c.slice(0, 3).map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  // What is painted behind e: every ancestor's background from the root down, each layer's alpha multiplied by the
  // opacity of that element and all its ancestors; a gradient/image layer counts as the house navy.
  // op is e's own effective opacity (product up the chain), used to blend its text.
  const paint = (e) => {
    const chain = []; for (let a = e; a; a = a.parentElement) chain.unshift(a);
    let c = [255, 255, 255, 1]; let op = 1;
    for (const a of chain) {
      const cs = getComputedStyle(a); op *= Number(cs.opacity);
      if (/gradient|url\\(/.test(cs.backgroundImage)) c = over([10, 22, 40, op], c);
      const bc = parse(cs.backgroundColor); if (bc && bc[3] > 0) c = over([bc[0], bc[1], bc[2], bc[3] * op], c);
    }
    return { bg: c, op };
  };
  // Finish slide transitions and entrance animations at once so colours are measured at their resting opacity.
  const st = document.createElement('style');
  st.textContent = '.slide,.slide *{animation-delay:0s!important;animation-duration:0s!important;transition:none!important}';
  document.head.append(st);
  return { parse, over, lum, ratio, paint };
})();`;

before(async () => {
  if (!tools) return;
  const puppeteer = createRequire(join(tools, 'package.json'))('puppeteer-core');
  browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new',
    args: ['--no-sandbox', '--font-render-hinting=none'], userDataDir: process.env.CDR_PROFILE });
});
after(async () => { if (browser) await browser.close(); });

async function open(path, requests = []) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.setRequestInterception(true);
  page.on('request', async (r) => {
    requests.push(r.url());
    const u = new URL(r.url());
    if (u.hostname !== 'cdr.test') return r.abort();
    let p = decodeURIComponent(u.pathname); if (p.endsWith('/')) p += 'index.html';
    try { r.respond({ status: 200, contentType: TYPES[extname(p)] || 'application/octet-stream', body: await readFile(join(root, p)) }); }
    catch { r.respond({ status: 404, body: '' }); }
  });
  await page.goto(`http://cdr.test/${path}`, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(HELPERS);
  return page;
}

// Static: no restyled CDR page or its shared CSS mentions Lato or Google Fonts at all.
// (cdr/construction-pitch.html and cdr/blog/ are outside CDR-RESTYLE and not covered.)
test('no Lato or Google Fonts in any restyled CDR source file', async () => {
  const files = ['cdr/index.html', ...DECKS, 'cdr/deck.css', 'cdr/landing.css'];
  const hits = [];
  for (const f of files) {
    (await readFile(join(root, f), 'utf8')).split('\n').forEach((l, i) => { if (LATO_URL.test(l)) hits.push(`${f}:${i + 1}`); });
  }
  assert.deepEqual(hits, []);
});

for (const path of PAGES) {
  test(`${path}: no Lato request, @import, @font-face or computed font`, { skip: !tools && 'set CDR_TEST_TOOLS' }, async () => {
    const requests = [];
    const page = await open(path, requests);
    const r = await page.evaluate(() => {
      const rules = [];
      const walk = (sheet) => { let list; try { list = sheet.cssRules; } catch { return; } for (const x of list) { if (x.styleSheet) { rules.push('@import ' + x.href); walk(x.styleSheet); } else if (/lato/i.test(x.cssText)) rules.push(x.cssText.slice(0, 80)); } };
      for (const s of document.styleSheets) { if (s.href && /lato|googleapis/i.test(s.href)) rules.push('link ' + s.href); walk(s); }
      return { rules: rules.filter((x) => /lato|googleapis|gstatic/i.test(x)),
        computed: [...document.querySelectorAll('*')].filter((e) => /lato/i.test(getComputedStyle(e).fontFamily)).length };
    });
    await page.close();
    assert.deepEqual({ requests: requests.filter((u) => LATO_URL.test(u)), ...r }, { requests: [], rules: [], computed: 0 });
  });
}

test('cdr/ landing: house primary button and cyan h1 bar', { skip: !tools && 'set CDR_TEST_TOOLS' }, async () => {
  const page = await open('cdr/');
  const s = await page.evaluate(() => {
    const b = getComputedStyle(document.querySelector('.btn-cdr'));
    const bar = getComputedStyle(document.querySelector('.cdr-hero h1'), '::after');
    return { btnBg: b.backgroundColor, btnColor: b.color, btnRadius: b.borderRadius,
      bar: { display: bar.display, width: bar.width, height: bar.height, bg: bar.backgroundColor } };
  });
  await page.close();
  assert.deepEqual(s, { btnBg: 'rgb(95, 196, 214)', btnColor: 'rgb(10, 22, 40)', btnRadius: '8px',
    bar: { display: 'block', width: '44px', height: '3px', bg: 'rgb(95, 196, 214)' } });
});

for (const deck of DECKS) {
  test(`${deck}: blended contrast >= 4.5:1 text, 3:1 large text and symbol glyphs, every slide EN+FR`, { skip: !tools && 'set CDR_TEST_TOOLS' }, async () => {
    const page = await open(deck);
    const fails = await page.evaluate(async () => {
      const { parse, over, ratio, paint } = window.__cdr;
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const slides = [...document.querySelectorAll('.slide')];
      const out = [];
      for (const lang of ['en', 'fr']) {
        document.body.classList.toggle('lang-fr', lang === 'fr');
        for (let i = 0; i < slides.length; i++) {
          slides.forEach((s, j) => { s.classList.remove('exit'); s.classList.toggle('active', j === i); });
          await sleep(150);
          for (const e of slides[i].querySelectorAll('*')) {
            const own = [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('');
            // Glyphs that carry colour: drop emoji (painted in their own colours), variation selectors, joiners, spaces.
            const glyphs = own.replace(/[\p{Emoji_Presentation}\uFE0F\u200D\s]/gu, '');
            if (!glyphs) continue;
            const cs = getComputedStyle(e); const r = e.getBoundingClientRect();
            if (!r.width || !r.height || cs.visibility === 'hidden' || cs.display === 'none') continue;
            // Decorative watermarks (the big .section-num digits) are aria-hidden and exempt; see docs/cdr.md.
            if (e.closest('[aria-hidden="true"]')) continue;
            const { bg, op } = paint(e);
            if (op < 0.01) continue; // fully transparent: not painted at all
            const fg = parse(cs.webkitTextFillColor && cs.webkitTextFillColor !== cs.color ? cs.webkitTextFillColor : cs.color);
            if (!fg) continue;
            // Arrows and other symbol-only glyphs are graphics (WCAG 1.4.11): 3:1. Text: 4.5:1, or 3:1 when large.
            const graphic = !/[\p{L}\p{N}]/u.test(glyphs);
            const px = parseFloat(cs.fontSize); const large = px >= 24 || (px >= 18.66 && Number(cs.fontWeight) >= 700) || (px >= 24 && Number(cs.fontWeight) >= 600);
            const need = graphic || large ? 3 : 4.5; const got = ratio(over([fg[0], fg[1], fg[2], fg[3] * op], bg), bg);
            if (got < need) out.push(`${lang} s${i + 1} ${e.tagName.toLowerCase()}.${String(e.className).trim().split(/\s+/).join('.')} ${got.toFixed(2)}<${need} fg=${cs.color} op=${op.toFixed(2)} "${own.trim().slice(0, 24)}"`);
          }
        }
      }
      return out;
    });
    await page.close();
    assert.deepEqual(fails, []);
  });
}

// Every deck slide uses a house background: the navy gradient (dark) or #F4F7FA / white (light). Catches leftover old gradients.
for (const deck of DECKS) {
  test(`${deck}: every slide has a house background`, { skip: !tools && 'set CDR_TEST_TOOLS' }, async () => {
    const page = await open(deck);
    const bad = await page.evaluate(() => [...document.querySelectorAll('.slide')].map((s, i) => {
      const c = getComputedStyle(s);
      const dark = c.backgroundImage.includes('rgb(3, 7, 15)') && c.backgroundImage.includes('rgb(10, 22, 40)');
      const light = c.backgroundImage === 'none' && ['rgb(244, 247, 250)', 'rgb(255, 255, 255)'].includes(c.backgroundColor);
      return dark || light ? null : `s${i + 1} ${s.className} ${c.backgroundColor} ${c.backgroundImage.slice(0, 60)}`;
    }).filter(Boolean));
    await page.close();
    assert.deepEqual(bad, []);
  });
}

// Colour tokens (Tobias-confirmed 2026-10-26). Literal colours live only in :root token definitions; every rule
// (CSS and inline style, in each HTML file and both shared stylesheets) uses var(...), with alpha as
// color-mix(in srgb, var(--token) N%, transparent).
const TOKEN_FILES = ['cdr/deck.css', 'cdr/landing.css'];
const SHARED_TOKENS = ['--acc', '--acc-hover', '--acc-on-light', '--black', '--border-light', '--green', '--green-on-light', '--ink-grey',
  '--ink-muted', '--navy', '--navy-deep', '--navy-mid', '--surface-light', '--white'];
const tokensOf = (css) => Object.fromEntries([...css.matchAll(/(--[a-z-]+)\s*:\s*(#[0-9a-f]{6})\b/gi)]
  .filter((m) => SHARED_TOKENS.includes(m[1])).map((m) => [m[1], m[2].toLowerCase()]));
const hexLum = (h) => { const v = [1, 3, 5].map((k) => { let x = parseInt(h.slice(k, k + 2), 16) / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
const hexRatio = (a, b) => { const [x, y] = [hexLum(a), hexLum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('colour tokens: defined identically in each CSS file and meet AA on their surfaces', async () => {
  const got = [];
  for (const f of TOKEN_FILES) {
    const t = tokensOf(await readFile(join(root, f), 'utf8'));
    assert.deepEqual(Object.keys(t).sort(), SHARED_TOKENS, f);
    got.push(t);
    const pairs = [['--acc-on-light', '--surface-light'], ['--acc-on-light', '--white'], ['--green-on-light', '--surface-light'], ['--green-on-light', '--white'],
      ['--ink-grey', '--surface-light'], ['--ink-grey', '--white'], ['--navy', '--surface-light'],
      ['--acc', '--navy'], ['--acc', '--navy-deep'], ['--green', '--navy'], ['--green', '--navy-deep'], ['--ink-muted', '--navy'], ['--ink-muted', '--navy-deep'], ['--ink-muted', '--navy-mid']];
    for (const [fg, bg] of pairs) assert.ok(hexRatio(t[fg], t[bg]) >= 4.5, `${f} ${fg} on ${bg}: ${hexRatio(t[fg], t[bg]).toFixed(2)}`);
  }
  assert.deepEqual(got[0], got[1]);
});

// Any hex, rgb()/rgba()/hsl()/hsla() or named white/black colour outside a :root { } token block fails.
// (?<![&\w]) keeps HTML character references such as &#8594; out of the hex match.
const LITERAL = /(?<![&\w])#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(|(?:color|background(?:-color)?|border(?:-[a-z]+)*|fill|stroke|outline(?:-color)?)\s*:[^;"}]*(?<![\w-])(?:white|black)(?![\w-])/gi;
test('no in-scope file uses a literal colour outside the :root token definitions', async () => {
  const hits = [];
  for (const f of ['cdr/index.html', ...DECKS, ...TOKEN_FILES]) {
    // Blank out :root blocks but keep their newlines so reported line numbers stay right.
    const src = (await readFile(join(root, f), 'utf8')).replace(/:root\s*\{[^}]*\}/g, (m) => m.replace(/[^\n]/g, ' '));
    src.split('\n').forEach((l, i) => { for (const m of l.matchAll(LITERAL)) hits.push(`${f}:${i + 1} ${m[0].slice(0, 40)}`); });
  }
  assert.deepEqual(hits, []);
});

// Tobias (c): cards that sit on a light surface carry the neutral --border-light (#E3E9F0) on every drawn side,
// never an accent (red, teal, gold, cyan) border. Covers the project-plan s15 .metric-card grid.
const LIGHT_CARDS = '.card, .metric-card, .card-persona, .hw-card';
for (const deck of DECKS) {
  test(`${deck}: cards on light slides have #E3E9F0 borders`, { skip: !tools && 'set CDR_TEST_TOOLS' }, async () => {
    const page = await open(deck);
    const r = await page.evaluate((sel) => {
      const { lum, paint } = window.__cdr; const NEUTRAL = 'rgb(227, 233, 240)';
      const out = []; let checked = 0; const slides = [...document.querySelectorAll('.slide')];
      for (const lang of ['en', 'fr']) {
        document.body.classList.toggle('lang-fr', lang === 'fr');
        slides.forEach((s, i) => {
          slides.forEach((x, j) => x.classList.toggle('active', j === i));
          for (const e of s.querySelectorAll(sel)) {
            const cs = getComputedStyle(e); const box = e.getBoundingClientRect();
            if (!box.width || !box.height || cs.display === 'none') continue;
            if (lum(paint(e.parentElement).bg) <= 0.18) continue; // card sits on a dark surface
            checked++;
            for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
              if (parseFloat(cs[`border${side}Width`]) > 0 && cs[`border${side}Style`] !== 'none' && cs[`border${side}Color`] !== NEUTRAL)
                out.push(`${lang} s${i + 1} ${e.tagName.toLowerCase()}.${String(e.className).trim().split(/\s+/).join('.')} border-${side.toLowerCase()} ${cs[`border${side}Width`]} ${cs[`border${side}Color`]}`);
            }
          }
        });
      }
      return { bad: [...new Set(out)], checked };
    }, LIGHT_CARDS);
    await page.close();
    assert.ok(r.checked > 0, 'no light-slide card found: selector drifted');
    assert.deepEqual(r.bad, []);
  });
}

// Cyan 2px top line only on dark cards; the on-light accent only as text, links or thin (<=4px) rules.
for (const deck of DECKS) {
  test(`${deck}: cyan top line only on dark cards; on-light accent only text/thin rules`, { skip: !tools && 'set CDR_TEST_TOOLS' }, async () => {
    const page = await open(deck);
    const bad = await page.evaluate(() => {
      const rgb = (h) => `rgb(${[1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16)).join(', ')})`;
      const root = getComputedStyle(document.documentElement);
      const ACC = rgb(root.getPropertyValue('--acc').trim()); const ONL = rgb(root.getPropertyValue('--acc-on-light').trim());
      const out = []; const slides = [...document.querySelectorAll('.slide')];
      for (const lang of ['en', 'fr']) {
        document.body.classList.toggle('lang-fr', lang === 'fr');
        slides.forEach((s, i) => {
          slides.forEach((x, j) => x.classList.toggle('active', j === i));
          for (const e of s.querySelectorAll('*')) {
            const cs = getComputedStyle(e); const r = e.getBoundingClientRect();
            if (!r.width || !r.height || cs.display === 'none') continue;
            const tag = `${lang} s${i + 1} ${e.tagName.toLowerCase()}.${String(e.className).trim().split(/\s+/).join('.')}`;
            // Composite background behind/at the element (gradient = house navy), as in the contrast test.
            const light = window.__cdr.lum(window.__cdr.paint(e).bg) > 0.18; // 0.18 = mid-grey
            const topLine = parseFloat(cs.borderTopWidth) >= 2 && cs.borderTopColor === ACC && cs.borderBottomColor !== ACC;
            if (topLine && light) out.push(`${tag} cyan top line on light card`);
            if (e.classList.contains('card-dark') && !(cs.borderTopWidth === '2px' && cs.borderTopColor === ACC)) out.push(`${tag} dark card lacks cyan top line`);
            if (cs.backgroundColor === ONL && Math.min(r.width, r.height) > 4) out.push(`${tag} on-light accent as fill ${Math.round(r.width)}x${Math.round(r.height)}`);
            for (const side of ['Top', 'Right', 'Bottom', 'Left']) if (cs[`border${side}Color`] === ONL && parseFloat(cs[`border${side}Width`]) > 4) out.push(`${tag} thick on-light border`);
          }
        });
      }
      return [...new Set(out)];
    });
    await page.close();
    assert.deepEqual(bad, []);
  });
}
