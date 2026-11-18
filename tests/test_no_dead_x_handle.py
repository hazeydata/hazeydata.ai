import os
import re
import subprocess
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKIP_TOP = ("scripts/", "tests/", "migrations/", "functions/", "node_modules/", "scheduled/")
# pages covered by TPCR-DISCORD-GROWTH-001 side fix
CHECKED = ("theme-park-crowd-report/", "blog/", "updates/", "assets/",
           "index.html", "contact.html", "pricing.html", "bio.html")
META_TWITTER_SITE = re.compile(r"<meta\b[^>]*twitter:site[^>]*>", re.I)
HREF_DEAD = re.compile(r"href\s*=\s*[\"'][^\"']*disneystatswhiz", re.I)
TEXT_DEAD = re.compile(r"@disneystatswhiz", re.I)


def shipped_html():
    """Tracked .html files that scripts/build-public-site.sh would ship."""
    out = subprocess.check_output(["git", "ls-files", "-z", "*.html"], cwd=ROOT)
    for s in out.decode().split("\0"):
        if not s:
            continue
        if not s.startswith(CHECKED):
            continue
        parts = s.split("/")
        if any(p.startswith(".") for p in parts) or s.startswith(SKIP_TOP):
            continue
        if "docs" in parts[:-1] or "node_modules" in parts[:-1]:
            continue
        yield s


class NoDeadXHandleTest(unittest.TestCase):
    def test_no_rendered_disneystatswhiz(self):
        bad = []
        for rel in shipped_html():
            with open(os.path.join(ROOT, rel), encoding="utf-8") as fh:
                html = META_TWITTER_SITE.sub("", fh.read())
            if HREF_DEAD.search(html) or TEXT_DEAD.search(html):
                bad.append(rel)
        self.assertEqual(bad, [], "dead X handle still rendered in: %s" % bad[:10])


if __name__ == "__main__":
    unittest.main()
