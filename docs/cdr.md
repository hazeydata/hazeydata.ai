# CDR pages (/cdr/)

| Page | File |
|---|---|
| Landing | `cdr/index.html` + `cdr/landing.css` |
| Project plan deck | `cdr/project-plan.html` (root copy: `cdr-project-plan.html`) |
| Pitch decks | `cdr/pitch.html`, `cdr/funding-pitch.html`, `cdr/pilot-pitch.html` |

## Style (CDR-RESTYLE, 2026-10-26)
The pages use the HazeyData house style (Direction B): navy/cyan tokens, Inter for body text, Space Grotesk for headings, self-hosted fonts from `/assets/fonts/fonts.css` (no Google Fonts).
- The decks keep their inline `<style>`. The shared house tokens and overrides live in `/cdr/deck.css`, which loads right after it. Change shared deck styling there.
- No Lato anywhere in the restyled pages: not in the markup, CSS, network requests or computed fonts. Heading fonts are set in the markup. The landing CTA comes before the crisis stats in the HTML. (`cdr/construction-pitch.html` is outside this restyle and unchanged: it does not use Lato, but it still loads Inter and JetBrains Mono from Google Fonts, as it does on master.)
- Light slides (`-white`, `-warm`, pilot's `-terry`) use navy text. Accent text on them (stat numbers, `.pill` labels) uses the house teal `#1B6F80` (5.38:1 on `#F4F7FA`). Cyan `#5FC4D6` is 1.89:1 there, so it is kept for dark slides and rules only. `deck.css` does this by remapping the accent tokens on light slides, while dark panels inside them keep cyan. Positive-state green is `#1B5E20` on light slides and `#66BB6A` on dark ones. Teal accents on dark slides resolve to cyan. Pilot's `.slide-terry` is a flat `--surface-light` (`#F4F7FA`) light slide and its `.slide-deep` uses the dark house gradient.
- Colour tokens (confirmed by Tobias 2026-10-26) are defined in `:root` of both `deck.css` and `landing.css`: `--acc:#5FC4D6` and `--green:#66BB6A` for dark surfaces, `--acc-on-light:#1B6F80` and `--green-on-light:#1B5E20` for light ones, `--acc-hover:#7FD3E1` for the CTA hover, and the house neutrals `--navy`, `--navy-deep`, `--navy-mid`, `--ink-muted` (`#A9B8C9`, captions on dark), `--ink-grey` (`#4A5B70`, secondary text on light), `--surface-light`, `--border-light` (`#E3E9F0`), `--white` and `--black`. Each deck's own legacy palette stays in its inline `:root` and `deck.css` remaps it to house tokens.
- Literal colours (hex, `rgb()`/`rgba()`, `hsl()`, named white/black) appear only inside `:root` token blocks. Every rule and inline style uses `var(...)`; translucent colours are written `color-mix(in srgb, var(--token) N%, transparent)`. `--acc-on-light` is for text, links and thin rules only, never fills (icon badges on light slides use `--acc` with navy text). The 2px cyan top line appears only on dark cards (`.card-dark`). Cards on light slides (`.card`, `.metric-card`, `.card-persona`, `.hw-card`) have neutral `--border-light` (`#E3E9F0`) borders on every side they draw, never an accent colour.
- The FR `body.lang-fr .x[data-lang="fr"]` rules only set `display`; columns come from the normal (responsive) class rules. Every FR grid copy carries `data-lang="fr"` (funding-pitch's FR `.four-col` included).
- Small captions and arrows are not faded with `opacity`. `.confidential` labels, the project-plan timeline phase captions and funding-pitch's closing footer use `--ink-muted` on dark slides, `.flow-arrow`/`.timeline-arrow` use `--ink-muted` on dark and `--ink-grey` on light slides, and `.metric-phase` is fully opaque.
- The large `.section-num` watermark digits are decorative and marked `aria-hidden="true"`.
- Wide tables (`.compare-table`, `.rev-table`, `.fund-table`) scroll sideways inside the slide. At 360px or narrower, slide h1s with an inline font size drop to 2.3rem.
- The landing page loads `styles.css`, `hazeydata-b.css` and then `cdr/landing.css`.
- Copy, the EN/FR `data-lang` pairs, `setLang()` and the deck controls (arrows, keyboard, dots, counter) are unchanged.

## Tests
- `tests/cdr/overflow-390.test.mjs` (the name predates the 320px pass): at 390×844 and 320×844, nothing overflows on any slide of any deck, in EN or FR. The landing page also fits, with the CTA above the stats.
- `tests/cdr/fr-grid.test.mjs`: at 1440px and 1024px, every FR grid has the same column count as its EN twin, so FR rules cannot override a deck's own responsive columns.
- `tests/cdr/style.test.mjs` checks:
  - no Lato or Google Fonts in the sources, requests, stylesheets or computed fonts
  - the landing page has the house cyan button and the 44px h1 bar
  - WCAG AA contrast on every slide, in EN and FR, on the colour actually painted: the text colour's alpha times the opacity of the element and every ancestor, composited over the ancestors' backgrounds (each faded by its own opacity). Text needs 4.5:1, large text 3:1, and symbol-only glyphs such as arrows 3:1 (graphics). It runs with entrance animations finished. Only `aria-hidden` decoration (the `.section-num` watermarks) and emoji are exempt.
  - the shared colour tokens match in both CSS files and meet AA on their surfaces
  - no in-scope file (landing, the decks, both CSS files) uses a literal colour outside a `:root` block
  - cards on light slides have `#E3E9F0` borders; light cards have no cyan top line, dark cards do; `--acc-on-light` is never a fill or a border thicker than 4px
  - every slide has a house background

    CDR_TEST_TOOLS=<dir with puppeteer-core> CHROME=/usr/bin/google-chrome node --test tests/cdr/
