# Post-Deploy Link Audit — HazeyData Restructure

Run through this checklist after the restructure goes live on master.

## 1. Website Internal Links
- [ ] Hub page → all project card links work
- [ ] Hub page → nav links (Projects, About, Contact)
- [ ] Hub page → footer links (all projects, Discord, Twitter, Contact)
- [ ] TPCR homepage → nav (Blog, Pricing, Discord)
- [ ] TPCR homepage → all section links (#features, #parks, etc.)
- [ ] TPCR blog index → every blog post link
- [ ] Each TPCR blog post → nav links, footer links, cross-references to other posts
- [ ] TPCR pricing page → all links
- [ ] TPCR year-view page → data fetches still work (relative JSON paths)
- [ ] CDR homepage → nav links, footer
- [ ] CDR blog index → article link
- [ ] CDR article → nav, footer, internal links
- [ ] CDR pitch pages → internal links, asset paths
- [ ] SSD page → nav, footer, links
- [ ] ACCORD page → nav, footer, links
- [ ] 404 page → all links work

## 2. Redirects (test every one)
- [ ] /blog/ → /theme-park-crowd-report/blog/
- [ ] /blog/what-is-wti.html → /theme-park-crowd-report/blog/what-is-wti.html
- [ ] /blog/new-metric.html → redirects correctly
- [ ] /blog/spring-break-disney-world-2026-survival-guide.html → redirects
- [ ] /blog/best-time-to-visit-disney-world-2026.html → redirects
- [ ] /blog/epic-universe-crowds-2026.html → redirects
- [ ] /blog/orlando-this-week-march-11-2026.html → redirects
- [ ] /blog/orlando-this-week-march-18-2026.html → redirects
- [ ] /blog/tokyo-this-week-march-17-2026.html → redirects
- [ ] /blog/disneyland-this-week-march-13-2026.html → redirects
- [ ] /blog/why-canada-needs-a-digital-railway.html → /cdr/blog/...
- [ ] /pricing.html → /theme-park-crowd-report/pricing.html
- [ ] /year-view.html → /theme-park-crowd-report/year-view.html
- [ ] /bio.html → /theme-park-crowd-report/bio.html
- [ ] /ssd.html → /ssd/
- [ ] /accord.html → /accord/
- [ ] /cdr-pitch.html → /cdr/pitch.html
- [ ] /cdr-funding-pitch.html → /cdr/funding-pitch.html
- [ ] /cdr-pilot-pitch.html → /cdr/pilot-pitch.html

## 3. Discord Bot
- [ ] `/crowd` command — any links it outputs (blog posts, website)
- [ ] `/ask` command — if it references website URLs
- [ ] `/best-day` command — check for hazeydata.ai links
- [ ] `/today` and `/now` commands — any embedded links
- [ ] Bot profile/about — check for old URLs
- [ ] Discord server description/links — update if referencing old paths

## 4. Social Media / External
- [ ] Twitter bio link (@disneystatswhiz)
- [ ] Twitter pinned tweet — any hazeydata.ai links
- [ ] Recent tweets with blog post links — note which need correction (can't edit tweets, but redirects cover this)
- [ ] Discord invite landing / server description
- [ ] Any Google Search Console entries — submit new sitemap
- [ ] Google Business Profile (if exists)

## 5. Email / Newsletters
- [ ] Subscribe/unsubscribe flow — test full cycle at new URLs
- [ ] Any sent emails with old blog links (redirects cover, but note)

## 6. themeparkcrowdreport.com
- [ ] **CRITICAL:** Set up Cloudflare redirect so this domain → /theme-park-crowd-report/
- [ ] Test both www and non-www variants
- [ ] Verify it doesn't just show the HazeyData hub

## 7. SEO
- [ ] Submit updated sitemap.xml to Google Search Console
- [ ] Verify canonical URLs are correct on all pages
- [ ] Check OG tags on all pages (use https://www.opengraph.xyz/ or similar)
- [ ] Verify robots.txt is correct

## 8. Assets
- [ ] All images loading (icons, banners, screenshots)
- [ ] CSS loading on all pages (styles.css path correct from each depth)
- [ ] Fonts loading (Inter, JetBrains Mono)
- [ ] Favicon showing on all pages

## Script to bulk-test redirects:
```bash
# Run after deploy — tests all redirects return 301
for url in \
  "/blog/" \
  "/blog/what-is-wti.html" \
  "/blog/new-metric.html" \
  "/blog/spring-break-disney-world-2026-survival-guide.html" \
  "/blog/best-time-to-visit-disney-world-2026.html" \
  "/blog/epic-universe-crowds-2026.html" \
  "/blog/why-canada-needs-a-digital-railway.html" \
  "/pricing.html" \
  "/year-view.html" \
  "/bio.html" \
  "/ssd.html" \
  "/accord.html" \
  "/cdr-pitch.html"; do
  STATUS=$(curl -sI "https://hazeydata.ai${url}" | head -1)
  LOCATION=$(curl -sI "https://hazeydata.ai${url}" | grep -i "^location:" | tr -d '\r')
  echo "${url} → ${STATUS} | ${LOCATION}"
done
```
