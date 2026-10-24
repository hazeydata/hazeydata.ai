#!/usr/bin/env python3
"""Fail if a deploy directory contains files that must not be published.

Usage: check-deploy-files.py [DIR] [--list]
  DIR     directory to check (default: dist)
  --list  print the files only; do not check
"""
import argparse
import os
import sys

FORBIDDEN_DIRS = {".wrangler", ".github", "scripts", "docs", "tests",
                  "migrations", "functions", "node_modules", "scheduled"}
FORBIDDEN_NAMES = {".env", ".dev.vars", ".gitignore"}


def forbidden_reason(rel):
    parts = rel.split("/")
    for p in parts[:-1]:
        if p.lower() in FORBIDDEN_DIRS:
            return "forbidden directory '%s'" % p
    name = parts[-1]
    low = name.lower()
    if low.endswith(".md"):
        return "markdown file"
    if low.startswith("package") and low.endswith(".json"):
        return "package file"
    if low in FORBIDDEN_NAMES:
        return "secret/config dotfile"
    return None


def list_files(root):
    out = []
    for dirpath, _dirs, files in os.walk(root):
        for f in files:
            out.append(os.path.relpath(os.path.join(dirpath, f), root).replace(os.sep, "/"))
    return sorted(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dir", nargs="?", default="dist")
    ap.add_argument("--list", action="store_true", help="print files only")
    args = ap.parse_args()

    if not os.path.isdir(args.dir):
        print("error: not a directory: %s" % args.dir, file=sys.stderr)
        return 2
    files = list_files(args.dir)
    for f in files:
        print(f)
    if args.list:
        return 0
    bad = []
    for f in files:
        reason = forbidden_reason(f)
        if reason:
            bad.append((f, reason))
    if bad:
        for f, r in bad:
            print("FORBIDDEN: %s (%s)" % (f, r), file=sys.stderr)
        return 1
    print("OK: %d files, none forbidden" % len(files), file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
