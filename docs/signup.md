# Newsletter signup (HD-SIGNUP-001, store-first)

`POST /api/subscribe` (functions/api/subscribe.js) saves every valid signup to D1 first, then forwards it to Beehiiv
if the Beehiiv secrets are set. If Beehiiv is unavailable the visitor still sees success and the row stays `pending`.
Pending rows go into Beehiiv by CSV import.

## Bindings and secrets (Cloudflare Pages project `hazeydata`, Production + Preview)
| Name | Kind | Required | Purpose |
|---|---|---|---|
| `SIGNUPS` | D1 binding to database `hazeydata-signups` | yes | signups table (`migrations/0001_signups.sql`) |
| `SIGNUP_RL` | KV namespace binding | yes | per-IP rate limit, 5 per 10 min |
| `EXPORT_TOKEN` | secret | yes for export | bearer token for the CSV export |
| `BEEHIIV_API_KEY`, `BEEHIIV_PUB_ID` | secrets | optional | live forward to Beehiiv |

Schema (once; idempotent): `npx wrangler d1 execute hazeydata-signups --remote --file=migrations/0001_signups.sql`

## Export pending signups
```bash
# EXPORT_TOKEN read from your password manager into the env; don't paste it into shell history
curl -fsS -H "Authorization: Bearer $EXPORT_TOKEN" \
  https://hazeydata.ai/api/signups/export.csv -o hazeydata-signups-pending.csv
```
- Without the right token the endpoint returns the site's normal 404.
- Columns: `email,source,utm_source,utm_medium,utm_campaign,created_at`. Pending rows only.
- Cells that start with `= + - @`, a tab or a CR get a leading `'` (spreadsheet formula guard). Check the email column before importing; an address that starts with `-` or `+` would carry the `'`.
- Beehiiv import: Settings > Subscribers Import > Upload CSV. `email` is the first column, as Beehiiv requires. Map `source` to the `utm_source` field, because the form's source slug is the attribution; the CSV's own `utm_source` column holds the visitor's incoming utm_source. Map `utm_medium`/`utm_campaign` the same way, and map `created_at` to a custom date field if wanted.
- Rows are not marked `forwarded` after an export (OQ6 is deferred; a manual follow-up is the default).

### Wrangler alternative (read-only)
```bash
npx wrangler d1 execute hazeydata-signups --remote --json \
  --command "SELECT email,source,utm_source,utm_medium,utm_campaign,created_at FROM signups WHERE status='pending' ORDER BY id"
```

## Retention
OQ7 is deferred. Default: keep rows until someone asks for deletion
(`npx wrangler d1 execute hazeydata-signups --remote --command "DELETE FROM signups WHERE email = '<lowercased email>'"`).
