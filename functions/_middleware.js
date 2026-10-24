import { MESSAGES, STATUSES } from '../assets/signup/signup-config.js';

const STATUS_SLOT = /(<p\b[^>]*\bdata-signup-status\b[^>]*)><\/p>/g;

// HD-SIGNUP-001 AC12: no-JS path. After the 303 back to ?signup=<status>, render the message server-side.
export function injectSignupStatus(html, status) {
  if (!STATUSES.includes(status)) return html;
  const text = MESSAGES[status].replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return html.replace(STATUS_SLOT, `$1 data-state="${status}">${text}</p>`);
}

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const host = url.hostname;

  // Redirect themeparkcrowdreport.com (and www) to TPCR sub-path on hazeydata.ai
  if (host === 'themeparkcrowdreport.com' || host === 'www.themeparkcrowdreport.com') {
    const newUrl = `https://hazeydata.ai/theme-park-crowd-report${url.pathname}${url.search}`;
    return Response.redirect(newUrl, 301);
  }

  const res = await context.next();
  const status = url.searchParams.get('signup');
  if (context.request.method !== 'GET' || !status || !STATUSES.includes(status)) return res;
  if (!(res.headers.get('Content-Type') || '').includes('text/html')) return res;
  const html = injectSignupStatus(await res.text(), status);
  const headers = new Headers(res.headers);
  headers.delete('Content-Length');
  headers.set('Cache-Control', 'no-store');
  return new Response(html, { status: res.status, headers });
}
