// HD-SIGNUP-001 AC16: every page that embeds the signup form must carry the partial verbatim,
// differing only in the hidden source value (which must be allowlisted).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { SOURCES } from '../assets/signup/signup-config.js';

const root = new URL('..', import.meta.url).pathname;
const norm = (s) => s.replace(/name="source" value="[^"]*"/, 'name="source" value="X"').replace(/\s+/g, ' ').trim();
const partialRaw = readFileSync(join(root, 'assets/signup/signup-form.html'), 'utf8').replace(/^<!--.*?-->\s*/s, '');
const want = norm(partialRaw);

function* htmlFiles(dir) {
  for (const n of readdirSync(dir)) {
    if (n.startsWith('.') || n === 'node_modules' || n === 'tests') continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) yield* htmlFiles(p); else if (n.endsWith('.html')) yield p;
  }
}

let problems = 0, pages = 0;
for (const f of htmlFiles(root)) {
  if (f.endsWith('assets/signup/signup-form.html')) continue;
  const html = readFileSync(f, 'utf8');
  for (const m of html.matchAll(/<form class="hd-signup"[\s\S]*?<\/form>/g)) {
    pages++;
    const sv = /name="source" value="([^"]*)"/.exec(m[0])?.[1];
    if (norm(m[0]) !== want) { console.log(`DRIFT ${f.slice(root.length)}`); problems++; }
    if (!SOURCES.includes(sv)) { console.log(`BAD_SOURCE ${f.slice(root.length)} ${sv}`); problems++; }
  }
}
console.log(`signup partial: ${pages} form(s), ${problems} problem(s)`);
process.exit(problems ? 1 : 0);
