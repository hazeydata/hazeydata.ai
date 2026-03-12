export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const slug = url.searchParams.get("slug");
  const mode = url.searchParams.get("mode") || "schedule"; // "now" or "schedule"

  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    return new Response("Invalid slug", { status: 400 });
  }

  const isNow = mode === "now";
  const modeLabel = isNow ? "🚀 Publish Now" : "📅 Schedule";
  const modeDesc = isNow
    ? "Wilma — publish this immediately."
    : "Wilma — schedule this for the next optimal time (morning, ~9-10 AM ET).";

  // Post to Discord webhook (content-review channel)
  const webhookUrl = context.env.DISCORD_CONTENT_WEBHOOK;

  if (webhookUrl) {
    try {
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: `${isNow ? "🚀" : "📅"} **Blog post approved: ${modeLabel}**\n\n**Slug:** \`${slug}\`\n**Draft:** https://hazeydata.ai/blog/drafts/${slug}.html\n\n${modeDesc}`,
        }),
      });
    } catch (e) {
      console.error("Webhook failed:", e);
    }
  }

  // Return confirmation page
  return new Response(
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Post Approved!</title>
  <style>
    body {
      font-family: 'Inter', -apple-system, sans-serif;
      background: #0a1628;
      color: #fff;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      text-align: center;
    }
    .card {
      background: #111d33;
      border: 1px solid #1a2a44;
      border-radius: 16px;
      padding: 3rem 2rem;
      max-width: 440px;
    }
    .icon { font-size: 3rem; margin-bottom: 1rem; }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
    p { color: #A0B0C8; font-size: 0.95rem; line-height: 1.6; }
    code { background: rgba(60,120,210,0.15); color: #3C78D2; padding: 0.15rem 0.4rem; border-radius: 4px; font-size: 0.9rem; }
    a { color: #3C78D2; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${isNow ? "🚀" : "📅"}</div>
    <h1>${isNow ? "Publishing Now!" : "Scheduled!"}</h1>
    <p><code>${slug}</code> has been approved. ${isNow ? "Wilma's on it — should be live within a minute." : "Wilma will publish it at the next optimal time (typically 9-10 AM ET)."}</p>
    <p style="margin-top: 1rem;"><a href="/blog/drafts/${slug}.html">← Back to draft</a></p>
  </div>
</body>
</html>`,
    {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    }
  );
}
