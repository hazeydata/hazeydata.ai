#!/usr/bin/env bash
# publish-blog.sh — Publish a draft blog post to the live blog
#
# Usage:
#   bash scripts/publish-blog.sh <slug>
#
# Example:
#   bash scripts/publish-blog.sh spring-break-2026
#
# What it does:
#   1. Moves /blog/drafts/<slug>.html → /blog/<slug>.html
#   2. Removes the draft banner from the published file
#   3. Adds a card to /blog/index.html
#   4. Rebuilds prev/next navigation chain
#   5. Git commits, pushes, and deploys to Cloudflare Pages

set -euo pipefail
cd "$(dirname "$0")/.."

SLUG="${1:-}"
if [[ -z "$SLUG" ]]; then
    echo "Usage: bash scripts/publish-blog.sh <slug>"
    exit 1
fi

DRAFT="blog/drafts/${SLUG}.html"
TARGET="blog/${SLUG}.html"

if [[ ! -f "$DRAFT" ]]; then
    echo "❌ Draft not found: $DRAFT"
    exit 1
fi

if [[ -f "$TARGET" ]]; then
    echo "⚠️  $TARGET already exists — overwriting"
fi

echo "📄 Moving draft to live..."
cp "$DRAFT" "$TARGET"

# Remove the draft banner
echo "🧹 Removing draft banner..."
sed -i '/<div class="draft-banner">/,/<\/div><!-- \/draft-banner -->/d' "$TARGET"

# Extract title and metadata from the file for the index card
TITLE=$(grep -oP '<h2[^>]*>\K[^<]+' "$TARGET" | head -1)
DATE=$(grep -oP '<span>\K[A-Z][a-z]+ [0-9]+, [0-9]+' "$TARGET" | head -1)
TAGS=$(grep -oP '<span class="tag">\K[^<]+' "$TARGET")
DESCRIPTION=$(grep -oP 'meta name="description" content="\K[^"]+' "$TARGET" | head -1)

echo "  Title: $TITLE"
echo "  Date: $DATE"
echo "  Tags: $(echo $TAGS | tr '\n' ', ')"

# Build the card HTML
TAG_HTML=""
for tag in $TAGS; do
    TAG_HTML="${TAG_HTML}                    <span class=\"tag\">${tag}</span>\n"
done

CARD=$(cat <<CARD_EOF

            <!-- ${SLUG} -->
            <a href="/blog/${SLUG}.html" class="blog-card">
                <div class="blog-card-meta">
                    <span>${DATE}</span>
$(echo -e "$TAG_HTML")                </div>
                <h3>${TITLE}</h3>
                <p>${DESCRIPTION}</p>
                <span class="read-more">Read article →</span>
            </a>
CARD_EOF
)

# Add to index (after <div class="blog-list">)
echo "📋 Adding card to blog index..."
CARD_ESCAPED=$(echo "$CARD" | sed 's/[&/\]/\\&/g' | sed ':a;N;$!ba;s/\n/\\n/g')
sed -i "/<div class=\"blog-list\">/a\\${CARD_ESCAPED}" "blog/index.html"

# Remove the draft file
echo "🗑️  Removing draft..."
rm "$DRAFT"

echo "✅ Published: /blog/${SLUG}.html"
echo ""
echo "⚠️  NOTE: You still need to manually update prev/next links on adjacent articles."
echo "    Then run:"
echo "      git add -A && git commit -m 'Publish blog: ${SLUG}' && git push"
echo "      CLOUDFLARE_API_TOKEN=... npx wrangler pages deploy . --project-name=hazeydata --commit-dirty=true"
echo ""
echo "Done! 🦴"
