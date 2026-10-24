# Cloudflare deploy: account and token

How `.github/workflows/deploy.yml` authenticates to Cloudflare, and what to check when it fails.
Never put token values or account IDs in this repo.

## Account
- Fred-reported, not verified: the correct Cloudflare account is the **Graceland account**: in the dashboard account switcher its name is the Graceland Gmail address followed by "'s Account".
- Fred-reported, not verified: the D1 database `hazeydata-signups` lives in the Graceland account.
- Fred-reported, not verified: a separate account under Fred's hazeydata.ai work address exists. It is **not** the right one. Don't create tokens or resources there.

## Repo secrets
| Secret | What it is |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Fred-reported, not verified: API token **`hazeydata-ai-github-deploy`**, created Oct 24, 2026, scoped to the Graceland account only, with permissions **D1: Edit**, **Cloudflare Pages: Edit**, **Account Settings: Read**. |
| `CLOUDFLARE_ACCOUNT_ID` | Older secret (last updated about 7 months before Oct 2026). That it points at the Graceland account is inferred from attempt 5 of run 40076036664 succeeding on Oct 24, 2026; not checked directly. |

The tokens named **"Wilma Deploy"** and **"side_hustle_token"** are unrelated to this repo. Don't use them here, and don't rotate or delete them because of this repo.

## Which token is in use?
Cloudflare dashboard → My Profile → API Tokens: check the **Last used** column. After a deploy, `hazeydata-ai-github-deploy` should show a recent Last used time. As of Oct 24, 2026, nobody has checked Last used yet.

## Symptom: `Authentication error [code: 10000]`
The `Apply D1 schema (idempotent)` step fails with
`A request to the Cloudflare API (/accounts/***/d1/database) failed. Authentication error [code: 10000]`.
This means `CLOUDFLARE_API_TOKEN` holds a token that can't see the Graceland account, or lacks D1 Edit.
Fix: replace the secret with a token scoped to the Graceland account with the permissions above, then re-run the workflow.

### Incident, Oct 24, 2026
- The #32 deploy (squash `c8d94b6280dd219043b0bffcbba55d9b13b86af6`, run 40076036664) failed at `Apply D1 schema (idempotent)` with error 10000. The old `CLOUDFLARE_API_TOKEN` was a token that couldn't see the Graceland account.
- Attempt 1 failed at 3:55 AM ET; attempts 2, 3 and 4 failed at 6:11, 6:17 and 6:29 AM ET.
- After the secret was replaced with `hazeydata-ai-github-deploy`, attempt 5 succeeded at 6:32 AM ET: D1 schema, Pages deploy, signups table check and the GET 405 check all passed.

## Check after a deploy
`curl -s -o /dev/null -w '%{http_code}\n' https://hazeydata.ai/api/subscribe` must print `405`.
Use GET only. Never POST to it as a check; a POST creates a real signup.
