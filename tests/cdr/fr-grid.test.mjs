// CDR decks at desktop and tablet widths: every FR grid lays out with the same number of columns as its EN twin.
// The FR copies of .two-col/.three-col/.four-col carry data-lang="fr" and are shown with body.lang-fr rules; those
// rules must not override the deck's own column counts (e.g. funding-pitch's 2-column .four-col at <=1024px).
// Needs puppeteer-core: CDR_TEST_TOOLS=<dir with node_modules>, CHROME=<chrome path>. Optional CDR_ROOT=<site checkout>.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

const tools = process.env.CDR_TEST_TOOLS || process.env.SIGNUP_TEST_TOOLS;
const root = process.env.CDR_ROOT || new URL('../..', import.meta.url).pathname;
const DECKS = ['cdr/project-plan.html', 'cdr/pitch.html', 'cdr/funding-pitch.html', 'cdr/pilot-pitch.html', 'cdr-project-plan.html'];
const WIDTHS = [1440, 1024];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
let browser;

before(async () => {
  if (!tools) return;
  const puppeteer = createRequire(join(tools, 'package.json'))('puppeteer-core');
  browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new',
    args: ['--no-sandbox', '--font-render-hinting=none'], userDataDir: process.env.CDR_PROFILE });
});
after(async () => { if (browser) await browser.close(); });

for (const deck of DECKS) {
  for (const W of WIDTHS) {
    test(`${deck} @${W}px: FR grids have the same column counts as EN`, { skip: !tools && 'set CDR_TEST_TOOLS' }, async () => {
      const page = await browser.newPage();
      try {
        await page.setViewport({ width: W, height: 900 });
        await page.setRequestInterception(true);
        page.on('request', async (r) => {
          const u = new URL(r.url());
          if (u.hostname !== 'cdr.test') return r.abort();
          const p = decodeURIComponent(u.pathname);
          try { r.respond({ status: 200, contentType: TYPES[extname(p)] || 'application/octet-stream', body: await readFile(join(root, p)) }); }
          catch { r.respond({ status: 404, body: '' }); }
        });
        await page.goto(`http://cdr.test/${deck}`, { waitUntil: 'load' });
        const r = await page.evaluate(() => {
          const slides = [...document.querySelectorAll('.slide')];
          const cols = (lang) => {
            document.body.classList.toggle('lang-fr', lang === 'fr');
            return slides.map((s, i) => {
              slides.forEach((x, j) => x.classList.toggle('active', j === i));
              return [...s.querySelectorAll('.two-col, .three-col, .four-col')].filter((g) => g.getBoundingClientRect().width)
                .map((g) => `${g.className.match(/\b(two|three|four)-col\b/)[0]}:${getComputedStyle(g).gridTemplateColumns.trim().split(/\s+/).length}`).join(' ');
            });
          };
          return { en: cols('en'), fr: cols('fr') };
        });
        const diff = r.en.map((e, i) => (e === r.fr[i] ? null : `s${i + 1} en[${e}] fr[${r.fr[i]}]`)).filter(Boolean);
        assert.ok(r.en.some(Boolean), 'no grids found');
        assert.deepEqual(diff, []);
      } finally { await page.close(); }
    });
  }
}
