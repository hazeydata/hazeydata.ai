// Redirect themeparkcrowdreport.com → hazeydata.ai/theme-park-crowd-report/
export async function onRequest(context) {
  const url = new URL(context.request.url);
  const host = url.hostname;

  // Redirect themeparkcrowdreport.com (and www) to TPCR sub-path on hazeydata.ai
  if (host === 'themeparkcrowdreport.com' || host === 'www.themeparkcrowdreport.com') {
    const newUrl = `https://hazeydata.ai/theme-park-crowd-report${url.pathname}${url.search}`;
    return Response.redirect(newUrl, 301);
  }

  return context.next();
}
