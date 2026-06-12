/**
 * A/B test assignment middleware for the SSD landing page.
 * Scope: /ssd/ and /ssd/index.html ONLY. Everything else passes through.
 *
 * How it works (server-side, sticky, no client flicker, SEO-safe):
 *   1. Read the `ab_ssd` cookie. If absent, assign A or B 50/50 and set a 1-year cookie.
 *   2. Fetch the chosen variant's static HTML on the same deployment.
 *   3. Inject a tiny beacon (exposure + CTA-conversion events -> /ssd/ab-event).
 *   4. Return it at the canonical /ssd/ URL with the Set-Cookie header.
 *
 * Bots (crawlers) are always served variant A and excluded from the experiment,
 * so indexing stays stable on one canonical page.
 *
 * Force a variant for QA:  /ssd/?ab=a  or  /ssd/?ab=b
 */

const COOKIE = "ab_ssd";
const VARIANTS = { a: "/ssd/_variants/a.html", b: "/ssd/_variants/b.html" };
const BOT_RE = /bot|crawl|spider|slurp|bing|google|baidu|yandex|duckduck|facebookexternalhit|embedly|quora|pinterest|slack|whatsapp|telegram|discord|preview|lighthouse|headless/i;

export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);

  // Only intercept the SSD landing page itself.
  const isLanding = url.pathname === "/ssd/" || url.pathname === "/ssd" || url.pathname === "/ssd/index.html";
  if (!isLanding) return next();

  const ua = request.headers.get("user-agent") || "";
  const isBot = BOT_RE.test(ua);

  // Resolve variant: query override > cookie > fresh 50/50. Bots -> always A, no cookie.
  const cookies = parseCookies(request.headers.get("cookie") || "");
  const forced = (url.searchParams.get("ab") || "").toLowerCase();
  let variant, setCookie = false;

  if (forced === "a" || forced === "b") {
    variant = forced;
  } else if (isBot) {
    variant = "a";
  } else if (cookies[COOKIE] === "a" || cookies[COOKIE] === "b") {
    variant = cookies[COOKIE];
  } else {
    variant = Math.random() < 0.5 ? "a" : "b";
    setCookie = true;
  }

  // Fetch the chosen variant's static HTML from this same deployment.
  const variantURL = new URL(VARIANTS[variant], url.origin);
  const res = await fetch(variantURL.toString(), { headers: { "user-agent": ua } });
  if (!res.ok) return next(); // fail open to the existing page if a variant is missing

  let html = await res.text();
  // Strip the variant files' noindex when serving at the canonical /ssd/ URL.
  // The raw variant files keep noindex (so direct hits aren't indexed as dupes),
  // but /ssd/ itself MUST stay indexable. Remove any robots-noindex meta tag.
  html = html.replace(/<meta[^>]*name=["']robots["'][^>]*>/gi, "");
  html = html.replace("</body>", beacon(variant, isBot) + "</body>");

  const headers = new Headers(res.headers);
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("cache-control", "no-store"); // assignment must not be cached at the edge
  headers.append("vary", "Cookie");
  if (setCookie) {
    headers.append(
      "set-cookie",
      `${COOKIE}=${variant}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`
    );
  }
  return new Response(html, { status: 200, headers });
}

function beacon(variant, isBot) {
  if (isBot) return ""; // never track crawlers
  return `
<script>(function(){
  var V=${JSON.stringify(variant)};
  function send(ev){try{
    navigator.sendBeacon('/ssd/ab-event', JSON.stringify({v:V,e:ev,t:Date.now()}));
  }catch(_){
    fetch('/ssd/ab-event',{method:'POST',keepalive:true,body:JSON.stringify({v:V,e:ev,t:Date.now()})});
  }}
  // Exposure: this visitor saw variant V.
  send('view');
  // Conversions: any element marked data-ab (primary CTA, trial, sample, checkout).
  document.addEventListener('click',function(e){
    var el=e.target.closest('[data-ab]'); if(el){send('cta:'+el.getAttribute('data-ab'));}
  },true);
})();</script>`;
}

function parseCookies(str) {
  const out = {};
  str.split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
