import os
import re
import sqlite3
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
        bad = (".wrangler/cache/pages.json", "docs/x.md", "tests/a.py", "migrations/1.sql",
               ".env", ".dev.vars", ".gitignore", "sub/.ENV", "scheduled/job.js",
               "Scheduled/x.js", "README.MD", "notes/a.Md", "package.json",
               "package-lock.json", "sub/package.dev.json")
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


class WorkflowTest(unittest.TestCase):
    def test_schema_applied_before_pages_deploy(self):
        wf = open(os.path.join(ROOT, ".github", "workflows", "deploy.yml")).read()
        migrate = wf.find("d1 execute hazeydata-signups --remote --file=migrations/0001_signups.sql")
        deploy = wf.find("pages deploy")
        self.assertGreaterEqual(migrate, 0, "migration step missing")
        self.assertGreater(deploy, migrate, "migration must run before pages deploy")
        self.assertIn("SELECT count(*) AS n FROM signups", wf[deploy:])


class MigrationTest(unittest.TestCase):
    def test_migration_is_idempotent_and_keeps_data_and_unique_index(self):
        sql = open(os.path.join(ROOT, "migrations", "0001_signups.sql")).read()
        db = sqlite3.connect(":memory:")
        try:
            db.executescript(sql)
            db.execute("INSERT INTO signups (email, source, created_at) VALUES (?, ?, ?)",
                       ("a@hazeydata.invalid", "home", "2026-10-24T00:00:00.000Z"))
            db.commit()
            db.executescript(sql)  # second apply must succeed
            rows = db.execute("SELECT email FROM signups").fetchall()
            self.assertEqual(rows, [("a@hazeydata.invalid",)])
            with self.assertRaises(sqlite3.IntegrityError):
                db.execute("INSERT INTO signups (email, source, created_at) VALUES (?, ?, ?)",
                           ("a@hazeydata.invalid", "home", "2026-10-24T00:00:01.000Z"))
        finally:
            db.close()


WRANGLER_SHA = "9acf94ace14e7dc412b076f2c5c20b8ce93c79cd"


def parse_deploy_steps(text):
    """Minimal stdlib parser: steps of jobs.deploy -> [{name, uses, run}]."""
    lines = text.splitlines()
    start = next(i for i, l in enumerate(lines) if l == "    steps:")
    blocks, cur = [], None
    for l in lines[start + 1:]:
        if l.startswith("      - "):
            cur = [l[8:]]
            blocks.append(cur)
        elif cur is not None and (l.startswith("        ") or not l.strip()):
            cur.append(l[8:] if l.startswith("        ") else "")
        elif l.strip():
            break
    steps = []
    for b in blocks:
        step = {"name": "", "uses": "", "run": "", "raw": "\n".join(b)}
        i = 0
        while i < len(b):
            m = re.match(r"(name|uses|run):\s*(.*)$", b[i])
            if m:
                key, val = m.groups()
                if key == "run" and val.strip() == "|":
                    body = []
                    i += 1
                    while i < len(b) and (b[i].startswith("  ") or not b[i].strip()):
                        body.append(b[i][2:])
                        i += 1
                    step["run"] = "\n".join(body).strip()
                    continue
                step[key] = val.strip()
            i += 1
        steps.append(step)
    return steps


class VerifyStepTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = open(os.path.join(ROOT, ".github", "workflows", "deploy.yml")).read()
        cls.steps = parse_deploy_steps(cls.text)

    def test_405_step_present_after_pages_deploy_and_get_only(self):
        names = [s["name"] for s in self.steps]
        v = [i for i, n in enumerate(names) if "expects 405" in n]
        self.assertEqual(len(v), 1, names)
        d = [i for i, s in enumerate(self.steps) if "command: pages deploy" in s["raw"]]
        self.assertTrue(d, "pages deploy step not found")
        self.assertGreater(v[0], d[0])
        run = self.steps[v[0]]["run"]
        self.assertNotEqual(run.strip(), "true")
        for needle in ("curl", "--max-time", "https://hazeydata.ai/api/subscribe", 'test "$code" = "405"'):
            self.assertIn(needle, run)
        for banned in ("-X POST", "--data", "-d "):
            self.assertNotIn(banned, run)

    def test_wrangler_action_pinned_to_sha(self):
        uses = [s["uses"] for s in self.steps if s["uses"].startswith("cloudflare/wrangler-action@")]
        self.assertGreaterEqual(len(uses), 3)
        for u in uses:
            self.assertEqual(u.split()[0], "cloudflare/wrangler-action@" + WRANGLER_SHA, u)


if __name__ == "__main__":
    unittest.main()
