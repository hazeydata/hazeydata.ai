#!/usr/bin/env python3
"""Check GoatCounter snippet placement in theme-park-crowd-report/index.html."""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / "theme-park-crowd-report" / "index.html"

COUNT_RE = re.compile(r'<script\b[^>]*\bdata-goatcounter=[^>]*\bsrc="//gc\.zgo\.at/count\.js"[^>]*>\s*</script>')
PATH_RE = re.compile(r'<script>\s*window\.goatcounter\s*=\s*\{path:[^<]*</script>')
PREFIX_RE = re.compile(r"return\s+'([^']*)'\s*\+\s*p")


def fail(msg):
    print("FAIL: " + msg)
    sys.exit(1)


def main():
    if not TARGET.is_file():
        fail("missing file: theme-park-crowd-report/index.html")
    html = TARGET.read_text(encoding="utf-8")

    counts = COUNT_RE.findall(html)
    if len(counts) != 1:
        fail("expected exactly 1 count.js script tag, found %d" % len(counts))
    paths = PATH_RE.findall(html)
    if len(paths) != 1:
        fail("expected exactly 1 window.goatcounter path script, found %d" % len(paths))

    count_m = COUNT_RE.search(html)
    path_m = PATH_RE.search(html)

    head_open = html.find("<head")
    head_close = html.find("</head>")
    if head_open == -1 or head_close == -1:
        fail("could not locate <head>...</head>")
    if not (head_open < path_m.start() and count_m.end() <= head_close):
        fail("goatcounter scripts are not inside <head>")

    if html[path_m.end():count_m.start()].strip() != "":
        fail("path script does not immediately precede count.js tag")

    prefix = PREFIX_RE.search(path_m.group(0))
    if not prefix or prefix.group(1) != "/tpcr":
        fail("path prefix must be exactly '/tpcr'")

    print("OK")


if __name__ == "__main__":
    main()
