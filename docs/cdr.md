# CDR pages (/cdr/)

| Page | File |
|---|---|
| Landing | `cdr/index.html` + `cdr/landing.css` |
| Project plan deck | `cdr/project-plan.html` (root copy: `cdr-project-plan.html`) |
| Pitch decks | `cdr/pitch.html`, `cdr/funding-pitch.html`, `cdr/pilot-pitch.html` |

## Style (CDR-RESTYLE, 2026-10-26)
The pages use the HazeyData house style (Direction B): navy/cyan tokens, Inter for body text, Space Grotesk for headings, self-hosted fonts from `/assets/fonts/fonts.css` (no Google Fonts).
- The decks keep their inline `<style>`. The shared house tokens and overrides live in `/cdr/deck.css`, which loads right after it. Change shared deck styling there.
- No Lato anywhere in the restyled pages: not in the markup, CSS, network requests or computed fonts. Heading fonts are set in the markup. The landing CTA comes before the crisis stats in the HTML. (`cdr/construction-pitch.html` is outside this restyle and still loads Lato.)
- Light slides (`-white`, `-warm`, pilot's `-terry`) use navy text. Accent text on them (stat numbers, `.pill` labels) uses the house teal `#1B6F80` (5.38:1 on `#F4F7FA`). Cyan `#5FC4D6` is 1.89:1 there, so it is kept for dark slides and rules only. `deck.css` does this by remapping the accent tokens on light slides, while dark panels inside them keep cyan. Positive-state green is `#1B5E20` on light slides and `#66BB6A` on dark ones. Teal accents on dark slides resolve to cyan. Pilot's `.slide-deep` uses the dark house gradient.
- Colour tokens (confirmed by Tobias 2026-10-26) are defined in `:root` of both `deck.css` and `landing.css`: `--acc:#5FC4D6` and `--green:#66BB6A` for dark surfaces, `--acc-on-light:#1B6F80` and `--green-on-light:#1B5E20` for light ones. Rules use `var(...)` only; hex appears only in those definitions. `--acc-on-light` is for text, links and thin rules only, never fills (icon badges on light slides use `--acc` with navy text). The 2px cyan top line appears only on dark cards (`.card-dark`); light cards have a neutral `#E3E9F0` top border.
- The FR `body.lang-fr .x[data-lang="fr"]` rules only set `display`; columns come from the normal (responsive) class rules.
- Wide tables (`.compare-table`, `.rev-table`, `.fund-table`) scroll sideways inside the slide. At 360px or narrower, slide h1s with an inline font size drop to 2.3rem.
- The landing page loads `styles.css`, `hazeydata-b.css` and then `cdr/landing.css`.
- Copy, the EN/FR `data-lang` pairs, `setLang()` and the deck controls (arrows, keyboard, dots, counter) are unchanged.

## Tests
- `tests/cdr/overflow-390.test.mjs` (the name predates the 320px pass): at 390×844 and 320×844, nothing overflows on any slide of any deck, in EN or FR. The landing page also fits, with the CTA above the stats.
- `tests/cdr/style.test.mjs` checks:
  - no Lato or Google Fonts in the sources, requests, stylesheets or computed fonts
  - the landing page has the house cyan button and the 44px h1 bar
  - text contrast is at least 4.5:1 (3:1 for large text) on every slide, in EN and FR. It runs with entrance animations finished, and skips text deliberately faded with `opacity` (captions, decoration).
  - the colour tokens match in both CSS files and meet AA on their surfaces; no in-scope file hard-codes the accent/green hex outside the definitions; light cards have no cyan top line, dark cards do; `--acc-on-light` is never a fill or a border thicker than 4px
  - every slide has a house background

    CDR_TEST_TOOLS=<dir with puppeteer-core> CHROME=/usr/bin/google-chrome node --test tests/cdr/
