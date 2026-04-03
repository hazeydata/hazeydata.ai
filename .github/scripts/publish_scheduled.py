#!/usr/bin/env python3
"""publish_scheduled.py — Move scheduled blog posts to their live directories.

Scans scheduled/ for manifest files (*.json). Each manifest specifies:
  - publish_date: YYYY-MM-DD (publish on or after this date)
  - post_file: filename of the HTML post (in same directory as manifest)
  - target_dir: where to move the post (e.g., "ssd/blog" or "theme-park-crowd-report/blog")
  - index_card_html: HTML snippet to insert at the top of the blog index

If today >= publish_date, the post is moved and the index is updated.

Manifest format (example: scheduled/ssd-week-of-2026-04-20.json):
{
  "publish_date": "2026-04-20",
  "post_file": "week-of-2026-04-20.html",
  "target_dir": "ssd/blog",
  "index_card_html": "<a href=\"week-of-2026-04-20.html\" class=\"blog-card\">...</a>"
}
"""

import datetime
import json
import os
import shutil
import sys
from pathlib import Path

SCHEDULED_DIR = Path("scheduled")
TODAY = datetime.date.today()


def find_manifests():
    """Find all JSON manifest files in scheduled/."""
    if not SCHEDULED_DIR.exists():
        return []
    return sorted(SCHEDULED_DIR.glob("*.json"))


def process_manifest(manifest_path):
    """Process a single manifest. Returns True if published, False if not yet due."""
    with open(manifest_path) as f:
        manifest = json.load(f)

    publish_date = datetime.date.fromisoformat(manifest["publish_date"])
    post_file = manifest["post_file"]
    target_dir = Path(manifest["target_dir"])
    index_card_html = manifest.get("index_card_html", "")

    if TODAY < publish_date:
        days_until = (publish_date - TODAY).days
        print(f"  SKIP: {post_file} — publishes {publish_date} ({days_until} days away)")
        return False

    # Check post file exists
    post_path = SCHEDULED_DIR / post_file
    if not post_path.exists():
        print(f"  ERROR: Post file not found: {post_path}", file=sys.stderr)
        return False

    # Check target directory exists
    if not target_dir.exists():
        print(f"  ERROR: Target directory not found: {target_dir}", file=sys.stderr)
        return False

    # Move the post
    dest = target_dir / post_file
    if dest.exists():
        print(f"  WARNING: {dest} already exists — overwriting")
    shutil.move(str(post_path), str(dest))
    print(f"  PUBLISHED: {post_file} -> {dest}")

    # Update blog index if card HTML provided
    if index_card_html:
        index_path = target_dir / "index.html"
        if index_path.exists():
            content = index_path.read_text()
            marker = '<div class="blog-list">'
            if marker in content and post_file not in content:
                content = content.replace(
                    marker,
                    f"{marker}\n{index_card_html}\n"
                )
                index_path.write_text(content)
                print(f"  INDEX UPDATED: {index_path}")
            elif post_file in content:
                print(f"  INDEX: {post_file} already in index — skipping")
            else:
                print(f"  WARNING: Could not find blog-list marker in {index_path}")
        else:
            print(f"  WARNING: No index.html found at {index_path}")

    # Remove the manifest
    manifest_path.unlink()
    print(f"  MANIFEST REMOVED: {manifest_path}")

    return True


def main():
    print(f"Publish Scheduled Posts — {TODAY}")
    print(f"={'=' * 50}")

    manifests = find_manifests()
    if not manifests:
        print("No scheduled posts found.")
        return

    print(f"Found {len(manifests)} manifest(s):\n")

    published = 0
    skipped = 0
    for m in manifests:
        print(f"Processing: {m.name}")
        if process_manifest(m):
            published += 1
        else:
            skipped += 1

    print(f"\n{'=' * 50}")
    print(f"Published: {published} | Skipped (future): {skipped}")


if __name__ == "__main__":
    main()
