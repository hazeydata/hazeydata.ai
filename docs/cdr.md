# CDR pages (/cdr/)

| Page | File |
|---|---|
| Landing | `cdr/index.html` + `cdr/landing.css` |
| Project plan deck | `cdr/project-plan.html` (root copy: `cdr-project-plan.html`) |
| Pitch decks | `cdr/pitch.html`, `cdr/funding-pitch.html`, `cdr/pilot-pitch.html` |

## Style (CDR-RESTYLE, 2026-10-26)
The pages use the HazeyData house style (Direction B): navy/cyan tokens, Inter for body text, Space Grotesk for headings, self-hosted fonts from `/assets/fonts/fonts.css` (no Google Fonts).
- The decks keep their inline `<style>`. The shared house tokens and overrides live in `/cdr/deck.css`, which loads right after it. Change shared deck styling there.
- Heading fonts are set in the markup (no inline Lato is left). The landing CTA comes before the crisis stats in the HTML.
- The landing page loads `styles.css`, `hazeydata-b.css` and then `cdr/landing.css`.
- Copy, the EN/FR `data-lang` pairs, `setLang()` and the deck controls (arrows, keyboard, dots, counter) are unchanged.

## Tests
`tests/cdr/overflow-390.test.mjs` checks at 390×844 that nothing overflows on every slide of every deck in EN and FR. It also checks that no element renders in Lato and that the landing fits 390 with the CTA above the stats.

    CDR_TEST_TOOLS=<dir with puppeteer-core> CHROME=/usr/bin/google-chrome node --test tests/cdr/overflow-390.test.mjs
