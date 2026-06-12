# SSD Landing Page — A/B Test

Server-side 50/50 split test of two SSD landing-page designs, running entirely on
Cloudflare Pages Functions + KV. No third-party analytics.

## Variants
- **A — "Editorial"** (`ssd/_variants/a.html`): warm/cream, Fraunces serif, premium-research feel.
- **B — "Data Terminal"** (`ssd/_variants/b.html`): dark, Linear/Vercel-tier, live terminal-map hero.

## How it works
- `functions/ssd/_middleware.js` intercepts only `/ssd/`. It reads the `ab_ssd` cookie,
  assigns A/B 50/50 if absent (sticky 1-year cookie), fetches the variant HTML, injects a
  beacon, and serves it at the canonical `/ssd/` URL. Bots → always A, no cookie (SEO-safe).
  QA override: `/ssd/?ab=a` or `/ssd/?ab=b`.
- `functions/ssd/ab-event.js` — `POST /ssd/ab-event` records `view` + `cta:*` events into KV.
- `functions/ssd/ab-results.js` — `GET /ssd/ab-results` returns the live scoreboard:
  exposures, conversions, rate, B-vs-A lift, z-test p-value, and a plain-English verdict.

## Conversions tracked (data-ab markers on real CTAs)
- `cta:api` — Get API Access ($99/mo)  ← primary signal
- `cta:sample` — Download free sample
- `cta:checkout` — Get started

## GO-LIVE CHECKLIST (one-time, in Cloudflare Pages dashboard)
1. Create a KV namespace, bind it to the Pages project as **`AB_EVENTS_KV`**.
2. (Optional) Set **`AB_ADMIN_KEY`** to gate `/ssd/ab-results?key=...`.
3. Merge this branch → `master`. Cloudflare auto-deploys.
4. Verify live: `/ssd/?ab=a` and `/ssd/?ab=b` render; `/ssd/` sets the `ab_ssd` cookie.

## Reading results
`curl https://hazeydata.ai/ssd/ab-results` (or with `?key=...`).
`significant:true` + a `leader` = trustworthy call (p<0.05). Until then, keep running.
Rule of thumb: need ~hundreds of conversions per arm before trusting a small lift.

## Rollback
Delete `functions/ssd/_middleware.js` (or revert this branch). `/ssd/` falls back to the
existing `ssd/index.html` untouched — the middleware fails open.

## Tested (local, wrangler pages dev)
Assignment ~50/50, cookie sticky, bots excluded, beacon injected, event sink 204s without
KV, results endpoint degrades gracefully, non-SSD pages pass through, z-test math verified
(normCdf(1.96)=0.9750; flags real effects, ignores small-sample noise).
