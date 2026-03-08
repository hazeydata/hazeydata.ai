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

## Troubleshooting

**Site didn't update after push?**
1. Check GitHub Actions: https://github.com/hazeydata/hazeydata.ai/actions
2. If the run failed, check the logs — usually a secret expiry or Cloudflare issue.
3. Manual deploy (emergency only): `cd ~/hazeydata.ai && CLOUDFLARE_API_TOKEN=$CLOUDFLARE_PAGES_TOKEN npx wrangler pages deploy . --project-name=hazeydata --branch=master`
