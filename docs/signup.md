# Newsletter signup (HD-SIGNUP-001, store-first)

`POST /api/subscribe` (functions/api/subscribe.js) saves every valid signup to D1 first, then forwards it to Beehiiv
if the Beehiiv secrets are set. If Beehiiv is unavailable the visitor still sees success and the row stays `pending`.
Pending rows go into Beehiiv by CSV import.

## Bindings and secrets (Cloudflare Pages project `hazeydata`, Production only)
| Name | Kind | Required | Purpose |
|---|---|---|---|
| `SIGNUPS` | D1 binding to database `hazeydata-signups` | yes | signups table (`migrations/0001_signups.sql`) |
| `SIGNUP_RL` | KV namespace binding | yes | per-IP rate limit, 5 per 10 min (fails open on a KV error, see below) |
| `EXPORT_TOKEN` | secret | yes for export | bearer token for the CSV export |
| `BEEHIIV_API_KEY`, `BEEHIIV_PUB_ID` | secrets | optional | live forward to Beehiiv |

**Preview deployments have no `SIGNUPS` or `SIGNUP_RL` binding** (checked read-only on Oct 27, 2026). On a preview URL,
`POST /api/subscribe` logs `status: error`, `reason: config` and stores nothing, and the rate limit falls back to
per-isolate memory. Test signups on production only, or add the preview bindings first (Fred's call; not done).

## Migrations
The deploy workflow does **not** apply migrations. Each migration is applied once, by hand, after Fred's go, through the
Cloudflare connector or wrangler, for example:
`npx wrangler d1 execute hazeydata-signups --remote --file=migrations/0001_signups.sql`.
`0001_signups.sql` is already applied: a read-only `sqlite_master` check on Oct 27, 2026 showed the `signups` table,
`signups_email_unique` and `signups_status` matching the file exactly.
Until Oct 27, 2026 the workflow re-applied `0001_signups.sql` on every deploy; that step was removed so CI no longer writes to D1.

The CI API token (`CLOUDFLARE_API_TOKEN`) only needs **Cloudflare Pages: Edit** plus **D1: Read** (for the read-only table
check below), on the Graceland account where `hazeydata-signups` lives. Re-scoping the current token down from D1 Edit is
Fred's call and has **not** been done yet. See `docs/deploy-cloudflare.md`.

## Deploy verification
After `pages deploy` the workflow runs two read-only checks, either of which fails the job:
1. `d1 execute hazeydata-signups --remote --command "SELECT count(*) AS n FROM signups"` (fails if the table is missing).
2. `GET https://hazeydata.ai/api/subscribe` must return 405 (proves the Function is live). The workflow never POSTs. The curl has `--max-time 20`.

These checks run after `pages deploy`, so a failure flags a bad deploy but cannot roll it back.
`cloudflare/wrangler-action` is pinned to the v3.15.0 commit SHA (`9acf94ace14e7dc412b076f2c5c20b8ce93c79cd`).

## Response and log fields
JSON response for a stored signup is `{"status":"subscribed"}` whether Beehiiv returned 2xx, is not configured, or failed
(AC31, spec R3). The body, status code and headers are byte-identical in all three cases, as is the no-JS 303 redirect, so
the response never reveals the forwarding outcome. A row Beehiiv did not accept stays `pending` (with `last_error_code` set
after a Beehiiv HTTP/network/timeout failure) for CSV import.

Every signup log line is JSON with `evt`, `status`, `source`, `beehiiv_status` and `reason` (null when not applicable); never emails, IPs, Beehiiv response text or keys.
`reason` (AC32) is only ever one of a fixed enum, never an error message or response body:
- `timeout`: the Beehiiv call was aborted after the timeout.
- `http_<code>`: Beehiiv answered with a non-2xx status (three-digit integer, for example `http_401`, `http_500`).
- `network`: the Beehiiv fetch failed for any other reason.
- `config`: Beehiiv secrets are not set, or `env.SIGNUPS` is not bound.
- `d1_write`: the D1 INSERT threw (for example a missing table).

Lines:
- `status: stored_not_forwarded`: stored, Beehiiv not configured or failed; `reason` is one of `config`, `http_<code>`, `timeout`, `network`.
- `status: error` with `reason: config`: `env.SIGNUPS` is not bound.
- `status: error` with `reason: d1_write`: the D1 write threw (for example a missing table). The visitor gets HTTP 502 and Beehiiv is not called.
- `log()` writes null for any reason outside the enum.

## Incident 2026-10-24
`migrations/0001_signups.sql` had never been applied to the remote D1, so the INSERT failed with "no such table: signups".
Every signup returned `error` and nothing was stored; Beehiiv was never called. Fixed by applying the schema (at the time, from the deploy
workflow; since Oct 27, 2026 by hand, see Migrations) and adding the verification steps above.

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

## Rate limit fails open
If the `SIGNUP_RL` KV read or write throws, the rate limit **fails open**: the request is not counted and goes on to the honeypot, email and store steps as usual (`overLimit` in `functions/api/subscribe.js`).
Why: a KV outage should not block real signups. The cost is that abuse isn't throttled while KV is down. The honeypot, the Origin allowlist and the unique-email constraint still apply, and duplicate rows can't be created.
Without the binding at all (local or preview), the limit falls back to per-isolate memory.
