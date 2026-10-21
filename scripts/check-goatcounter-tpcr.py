#!/usr/bin/env python3
"""Check GoatCounter snippet placement in theme-park-crowd-report/index.html."""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / "theme-park-crowd-report" / "index.html"

# Deliberately loose: match any <script> tag mentioning data-goatcounter or gc.zgo.at
# so bad variants are found and reported instead of silently missed.
COUNT_RE = re.compile(r'<script\b[^>]*?(?:data-goatcounter|gc\.zgo\.at)[^>]*>', re.IGNORECASE)
ATTR_RE = re.compile(r"""([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?""")
SKIP_DIRS = {".git", "node_modules"}
EXPECTED_ENDPOINT = "https://openmillage.goatcounter.com/count"
EXPECTED_SRC = "//gc.zgo.at/count.js"
COMMENT_RE = re.compile(r"<!--.*?-->", re.S)
NOSCRIPT_RE = re.compile(r"<noscript\b.*?</noscript\s*>", re.S | re.IGNORECASE)
PATH_RE = re.compile(r'<script>\s*window\.goatcounter\s*=\s*\{path:[^<]*</script>')
PREFIX_RE = re.compile(r"return\s+'([^']*)'\s*\+\s*p")


def fail(msg):
    print("FAIL: " + msg)
    sys.exit(1)


def strip_comments(s):
    """Drop HTML comments and <noscript> blocks so inert tags never count.

    A comment that mentions GoatCounter is itself a failure: it is either a
    disabled snippet or dead markup that would mislead the next reader.
    """
    for c in COMMENT_RE.findall(s):
        low = c.lower()
        if "goatcounter" in low or "gc.zgo.at" in low:
            fail("GoatCounter reference inside an HTML comment")
    s = COMMENT_RE.sub("", s)
    if "<!--" in s:
        fail("unterminated HTML comment")
    for block in NOSCRIPT_RE.findall(s):
        low = block.lower()
        if "goatcounter" in low or "gc.zgo.at" in low:
            fail("GoatCounter reference inside a <noscript> block")
    s = NOSCRIPT_RE.sub("", s)
    if re.search(r"<noscript\b", s, re.IGNORECASE):
        fail("unterminated <noscript> block")
    return s


def parse_attrs(tag):
    """Return list of (lowercased name, value or None) for the tag's attributes."""
    inner = re.sub(r"^<script\b|/?>$", "", tag, flags=re.IGNORECASE)
    attrs = []
    for m in ATTR_RE.finditer(inner):
        value = next((g for g in m.groups()[1:] if g is not None), None)
        attrs.append((m.group(1).lower(), value))
    return attrs


def scan_site():
    for path in sorted(ROOT.rglob("*.html")):
        rel = path.relative_to(ROOT)
        if any(part in SKIP_DIRS for part in rel.parts) or path == TARGET:
            continue
        text = strip_comments(path.read_text(encoding="utf-8", errors="replace")).lower()
        if "goatcounter" in text or "gc.zgo.at" in text:
            fail("GoatCounter reference found outside theme-park-crowd-report/index.html: %s" % rel.as_posix())


def main():
    if not TARGET.is_file():
        fail("missing file: theme-park-crowd-report/index.html")
    html = strip_comments(TARGET.read_text(encoding="utf-8"))

    scan_site()

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

    if path_m.start() >= count_m.start():
        fail("window.goatcounter config script must come before the count.js tag")
    if html[path_m.end():count_m.start()].strip() != "":
        fail("path script does not immediately precede count.js tag")

    tag = count_m.group(0)
    attrs = parse_attrs(tag)
    for name in ("data-goatcounter", "src"):
        if sum(1 for n, _ in attrs if n == name) != 1:
            fail("count.js tag must have exactly one %s attribute" % name)
    values = dict(attrs)
    if values["data-goatcounter"] != EXPECTED_ENDPOINT:
        fail("data-goatcounter must be exactly %r, got %r" % (EXPECTED_ENDPOINT, values["data-goatcounter"]))
    if values["src"] != EXPECTED_SRC:
        fail("src must be exactly %r, got %r" % (EXPECTED_SRC, values["src"]))
    if "http://" in tag.lower():
        fail("count.js tag must not contain an http:// endpoint")
    if not any(n == "async" and v is None for n, v in attrs):
        fail("count.js tag must have a bare async attribute")
    if not re.match(r"\s*</script>", html[count_m.end():], re.IGNORECASE):
        fail("count.js tag must be an empty script closed by </script>")

    prefix = PREFIX_RE.search(path_m.group(0))
    if not prefix or prefix.group(1) != "/tpcr":
        fail("path prefix must be exactly '/tpcr'")

    print("OK")


if __name__ == "__main__":
    main()
