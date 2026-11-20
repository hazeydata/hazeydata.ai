import os
import re
import struct
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE = os.path.join(ROOT, "theme-park-crowd-report", "discord.html")
IMG_URL = "https://hazeydata.ai/assets/tpcr-discord-card-1200x630.png"
INVITE = "https://discord.gg/2Estr7sbP7"


def meta(html, key, value):
    for tag in re.findall(r"<meta\b[^>]*>", html):
        if re.search(r'\b%s="%s"' % (key, re.escape(value)), tag):
            m = re.search(r'\bcontent="([^"]*)"', tag)
            return m.group(1) if m else None
    return None


class DiscordPageTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(PAGE, encoding="utf-8") as f:
            cls.html = f.read()

    def test_page_exists(self):
        self.assertTrue(os.path.isfile(PAGE))

    def test_image_urls_absolute_and_exact(self):
        self.assertEqual(meta(self.html, "property", "og:image"), IMG_URL)
        self.assertEqual(meta(self.html, "name", "twitter:image"), IMG_URL)

    def test_asset_is_1200x630_png(self):
        path = os.path.join(ROOT, "assets", IMG_URL.rsplit("/", 1)[1])
        self.assertTrue(os.path.isfile(path))
        with open(path, "rb") as f:
            head = f.read(24)
        self.assertEqual(head[:8], b"\x89PNG\r\n\x1a\n")
        self.assertEqual(head[12:16], b"IHDR")
        self.assertEqual(struct.unpack(">II", head[16:24]), (1200, 630))

    def test_card_and_text_tags(self):
        self.assertEqual(meta(self.html, "name", "twitter:card"), "summary_large_image")
        self.assertTrue(meta(self.html, "property", "og:title"))
        self.assertTrue(meta(self.html, "property", "og:description"))

    def test_redirect_and_visible_link(self):
        self.assertEqual(meta(self.html, "http-equiv", "refresh"), "0; url=" + INVITE)
        self.assertRegex(self.html, r'<a\b[^>]*href="%s"' % re.escape(INVITE))

    def test_no_goatcounter(self):
        self.assertNotIn("goatcounter", self.html.lower())


if __name__ == "__main__":
    unittest.main()
