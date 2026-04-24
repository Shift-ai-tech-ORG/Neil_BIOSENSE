# BioSense — Marketing Site

Premium, brand-compliant marketing website for BioSense. Inspired by the
cadence of compound.co, built bespoke for BioSense's preventative-health
positioning.

- **Typography:** Inter only (weights 300 / 500 / 800), per brand guidelines.
- **Palette:** Imperial Red `#F04D4D`, Grape `#7625B0`, Seasalt `#F7F7F7`, Night `#0A0A0A`.
- **Brand gradient:** `linear-gradient(135deg, #F04D4D → #7625B0)` — applied to the **mark only**, never to the wordmark.
- **No build step.** Static HTML + CSS + vanilla JS. Open in a browser, or serve the folder.

## Preview locally

From this folder:

```bash
# Python 3
python -m http.server 8765
# then open http://127.0.0.1:8765/
```

Or double-click `index.html`. (Cross-page links work either way.)

## File map

| Path | Purpose |
|---|---|
| `index.html` | Landing page — hero, stats, problem, how it works, data sources, product preview, testimonials, team, FAQ, waitlist CTA, footer |
| `about.html` | Brand story & philosophy (drawn directly from the brand guidelines), principles, team |
| `science.html` | How the data unifies, context & baselines, trust & privacy, citations |
| `assets/styles.css` | Shared design system — tokens, typography, components, responsive breakpoints, reduced-motion |
| `assets/main.js` | Vanilla JS for mobile nav, FAQ accordion, scroll reveal, nav shadow, hero video crossfade |
| `assets/logo.svg` | Favicon — the standalone brand mark in full color |
| `assets/biosense-logotype.svg` | Full brand lock-up (mark + wordmark), full color — used on light backgrounds (nav) |
| `assets/biosense-logotype-white.svg` | Full brand lock-up, all white — used on dark backgrounds (footer) |
| `assets/biosense-mark.svg` | Standalone brand mark, full color |
| `assets/biosense-mark-white.svg` | Standalone brand mark, all white |
| `assets/video/hero-*.mp4` | Hero background footage (runner / forest / ocean) — see credits below |

## Brand assets

The logo assets in `assets/` come directly from the brand team's
`Web/Logotype` and `Web/Logo Mark` folders. They are used two ways:

1. **Full lock-up (logotype)** — dropped in as `<img>` in the nav and footer.
   Light surfaces use `biosense-logotype.svg` (black wordmark + gradient mark);
   dark surfaces use `biosense-logotype-white.svg` (all white).
2. **Standalone mark** — inlined as a reusable `<symbol id="biosense-mark">`
   at the top of each HTML page so it can be referenced via `<use href="#biosense-mark">`
   wherever the mark needs to pick up page-level gradient defs
   (e.g. the "how it works" ring). The favicon (`assets/logo.svg`) is also
   the standalone mark.

Brand rules honoured by these assets:

- Brand gradient (Imperial Red `#F04D4D` → Grape `#7625B0`) only on the mark.
- Wordmark is solid Night on light, solid Seasalt / white on dark — never tinted with the gradient.
- No drop shadows, glows, bevels, or rotations on the logo.

## Editing

- **Colours:** change the four brand custom properties at the top of `assets/styles.css` (`--brand-red`, `--brand-grape`, `--brand-seasalt`, `--brand-night`). Everything downstream cascades.
- **Copy:** each page contains its copy inline in the HTML. Sections are clearly commented so you can find the block you want.
- **Nav / footer:** repeated across pages — update in all three HTML files (or extract to a shared include if you add a build step later).

## Brand compliance checklist

- Inter only (300 / 500 / 800) — mapped to Body / Body Large / Display per PDF.
- Brand gradient on the mark, chart accents, and sparing inline emphasis; **never** on the wordmark.
- Wordmark always solid Night (or Seasalt on dark), never tinted.
- No drop shadows, glows, bevels, or rotations anywhere on the logo.
- Minimum logo lock-up width respected (see `.logo--min { min-width: 120px }`).
- Clear-space preserved around every logo instance (nav, footer, in-hero).
- Palette strictly limited to the four approved colours (+ neutral opacity derivatives for lines/surfaces).
- WCAG AA contrast: Night on Seasalt = 20.7:1. Seasalt on Night = 20.7:1.
- `prefers-reduced-motion` respected — scroll reveal and transitions disabled.
- Semantic HTML (`header`/`nav`/`main`/`section`/`footer`) and keyboard-accessible interactions.

## Out of scope (by design)

- No blog / CMS.
- Waitlist form is a visual placeholder (submit is stubbed client-side). Wire to your ESP / backend when ready.
- No analytics or cookie banner yet.

## Hosting

Any static host works: GitHub Pages, Netlify, Vercel, Cloudflare Pages, S3 + CloudFront. The folder is self-contained.

## Hero video credits

The hero section uses a three-clip crossfade loop. All footage is from
[Pexels](https://www.pexels.com/) under the [Pexels licence](https://www.pexels.com/license/)
(free for commercial use, no attribution required — we credit the creators here as a courtesy).

| File | Source | Creator |
|---|---|---|
| `assets/video/hero-runner.mp4` | [Morning park jogging — female runner on trail (ID 32620158)](https://www.pexels.com/video/morning-park-jogging-female-runner-on-trail-32620158/) | Pexels contributor |
| `assets/video/hero-forest.mp4` | [Forest stream (ID 2330708)](https://www.pexels.com/video/2330708/) | Pexels contributor |
| `assets/video/hero-ocean.mp4` | [Ocean wave (ID 1409899)](https://www.pexels.com/video/1409899/) | Pexels contributor |

Clips are 1280×720 (H.264) to keep the initial payload light. If you swap in
final branded footage, keep the three-clip loop pattern and the filenames to
avoid touching HTML/CSS/JS.

The loop automatically disables itself for users with `prefers-reduced-motion`
set to `reduce`; they see a calm brand-tinted radial instead (see
`.hero__bg-fallback` in `assets/styles.css`).
