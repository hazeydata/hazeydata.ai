# Website Deployment

## How It Works

**Push to `master` → live site in ~30 seconds. That's it.**

GitHub Actions automatically deploys to Cloudflare Pages on every push.
No manual commands. No wrangler. No Cloudflare dashboard.

## To Update the Website

```bash
cd ~/hazeydata.ai
# make your changes
git add .
git commit -m "describe what you changed"
git push
# done — check https://hazeydata.ai in ~30 seconds
```

## What Gets Published

Only `dist/` is deployed, never the repo root. `scripts/build-public-site.sh [out_dir]` builds `dist/` (gitignored) from `git ls-files`, so untracked files never ship. It excludes `.wrangler/`, `.github/`, `scripts/`, `docs/` (any depth), `tests/`, `migrations/`, `functions/`, `node_modules/`, `scheduled/`, `*.md`, `package*.json`, and dotfiles. `functions/` is compiled by wrangler from the repo root, not served as assets.

`scripts/check-deploy-files.py [dir]` (default `dist`) prints the files and exits 1 naming any forbidden path; `--list` only prints them. Tests: `python3 -m unittest tests/test_deploy_files.py`.

## Important

- **This is the ONLY website repo.** Don't look for website files anywhere else.
- The old `theme-park-crowd-report/web/` folder was removed (March 2026). It's gone. Don't recreate it.
- Deploy workflow: `.github/workflows/deploy.yml`
- Cloudflare secrets (API token + account ID) are stored as GitHub repo secrets.
- Branch: `master` (not main)

## Domains

All of these serve from this repo:
- hazeydata.ai
- www.hazeydata.ai
- themeparkcrowdreport.com
- www.themeparkcrowdreport.com
- hazeydata.pages.dev

## Signup database

The workflow applies `migrations/0001_signups.sql` to the remote D1 `hazeydata-signups` before `pages deploy` (idempotent). After the deploy it verifies the table (`SELECT count(*) AS n FROM signups`) and that `GET /api/subscribe` returns 405 (the workflow never POSTs). These checks run after the deploy, so a failure flags a bad deploy but cannot roll it back. `CLOUDFLARE_API_TOKEN` needs **D1 Edit** permission in addition to Pages Edit. 2026-10-24 incident: the table was missing, so every signup returned `error` and nothing was stored. Details and log reasons: `docs/signup.md`.

## Troubleshooting

**Site didn't update after push?**
1. Check GitHub Actions: https://github.com/hazeydata/hazeydata.ai/actions
2. If the run failed, check the logs — usually a secret expiry or Cloudflare issue.
3. Manual deploy (emergency only): `cd ~/hazeydata.ai && bash scripts/build-public-site.sh && python3 scripts/check-deploy-files.py dist && CLOUDFLARE_API_TOKEN=$CLOUDFLARE_PAGES_TOKEN npx wrangler pages deploy dist --project-name=hazeydata --branch=master` (run from the repo root so `./functions` still deploys)

## SSD product site

School Schedules Database sells at **https://schoolschedulesdatabase.com**. Paths under `/ssd` on this repo 301 there — do not rebuild a parallel funnel here.
