// HD-SIGNUP-001 R2 AC26-28: GET /api/signups/export.csv (pending rows only), bearer EXPORT_TOKEN.
// Anything else under /api/signups/, a wrong method or a missing / wrong token gets the site's
// ordinary 404, byte-identical to an unknown path. OQ6 (marking rows forwarded) is deferred.

export const CSV_COLUMNS = ['email', 'source', 'utm_source', 'utm_medium', 'utm_campaign', 'created_at'];

export function notFound(request, env) {
  return env.ASSETS.fetch(new Request(new URL('/__hd_not_found__', request.url), { method: 'GET' }));
}

async function digest(s) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
}

// AC28: hash both sides to a fixed length, then compare every byte.
export async function tokenMatches(header, secret) {
  if (!secret || typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const [a, b] = await Promise.all([digest(header.slice(7)), digest(secret)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// AC27: neutralise spreadsheet formulas, then RFC 4180 quoting.
export function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(rows) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const r of rows) lines.push(CSV_COLUMNS.map((c) => csvCell(r[c])).join(','));
  return lines.join('\r\n') + '\r\n';
}

function log(status) { console.log(JSON.stringify({ evt: 'export', status })); }

export async function onRequest(context) {
  const { request, env, params } = context;
  if (params.file !== 'export.csv' || request.method !== 'GET') return notFound(request, env);
  if (!(await tokenMatches(request.headers.get('Authorization'), env.EXPORT_TOKEN))) {
    log('denied');
    return notFound(request, env);
  }
  let rows;
  try {
    const r = await env.SIGNUPS.prepare(
      `SELECT ${CSV_COLUMNS.join(', ')} FROM signups WHERE status = 'pending' ORDER BY id`,
    ).all();
    rows = r.results || [];
  } catch {
    log('error');
    return new Response('Export failed', { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
  log('ok');
  return new Response(toCsv(rows), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="hazeydata-signups-pending.csv"',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
}
