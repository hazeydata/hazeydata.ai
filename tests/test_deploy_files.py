import os
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, "scripts", "build-public-site.sh")
CHECK = os.path.join(ROOT, "scripts", "check-deploy-files.py")


def run_check(d):
    return subprocess.run([sys.executable, CHECK, d], capture_output=True, text=True)


class BuildPublicSiteTest(unittest.TestCase):
    def test_build_has_no_forbidden_paths(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "out")
            subprocess.run(["bash", BUILD, out], check=True, capture_output=True)
            r = run_check(out)
            self.assertEqual(r.returncode, 0, r.stderr)
            for required in ("index.html", "_redirects", "robots.txt",
                             "updates/tpcr/index.html"):
                self.assertTrue(os.path.isfile(os.path.join(out, required)), required)
            self.assertFalse(os.path.exists(os.path.join(out, "functions")))


class CheckerTest(unittest.TestCase):
    def test_checker_fails_on_forbidden_paths(self):
        bad = (".wrangler/cache/pages.json", "docs/x.md", "tests/a.py", "migrations/1.sql")
        with tempfile.TemporaryDirectory() as tmp:
            for rel in bad + ("index.html",):
                p = os.path.join(tmp, rel)
                os.makedirs(os.path.dirname(p), exist_ok=True)
                open(p, "w").close()
            r = run_check(tmp)
            self.assertEqual(r.returncode, 1)
            for rel in bad:
                self.assertIn(rel, r.stderr)
            self.assertNotIn("FORBIDDEN: index.html", r.stderr)


if __name__ == "__main__":
    unittest.main()
