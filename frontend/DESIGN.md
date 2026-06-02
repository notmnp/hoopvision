# Hooper — Design System ("The Matchup Issue")

The visual identity for Hooper, an NBA matchup-simulation app. The concept is a
**premium basketball almanac / sports magazine** — editorial, printed, human.
This file is the source-of-truth reference; the *implementation* lives in
`src/index.css` (tokens + utilities), `src/components/editorial.tsx`
(components), and the restyled shadcn primitives in `src/components/ui/`.

> If you change a token or add a utility, update this file too.

---

## 1. Concept & voice

- **Almanac / newsstand**, not a SaaS dashboard. Think SLAM / The Ringer /
  Panini stat-backs / sports-section broadsheet.
- Confident, witty, basketball-literate copy ("Who you got?", "Tale of the
  Tape", "The Verdict — 1,000 simulations"). Editorial kickers, not generic UI
  labels.
- **Light "Paper" is the default theme; dark "Ink" is the night edition.**

### The anti-AI rules (do NOT break these)
- **One accent only: vermillion.** No purple gradients, no glassmorphism, no
  neon, no rainbow charts.
- **No literal basketball-court backdrop** (center-circle + 3-pt-arc SVG). It's
  the #1 AI-sports cliché and was deliberately removed. Use **halftone dots /
  paper grain** for atmosphere instead.
- **Squared, printed feel:** `--radius: 0.25rem`. Flat cards with hairline
  borders — no big soft drop shadows. Dividers are hairline / double rules.
- **Gold is reserved for the champion moment only.** **Court-green is reserved
  for "LIVE" only.**
- Don't decorate emptiness with noise — fill it with structure (a stat band, a
  contents list) + restrained texture.

---

## 2. Color tokens (OKLCH)

Defined in `src/index.css` under `:root` (Paper) and `.dark` (Ink), exposed to
Tailwind via `@theme inline` (`bg-background`, `text-primary`, `bg-court`, …).
Neutrals are **warm-tinted** (hue ~55–85), never pure gray.

### Paper — light, default (`:root`)
| Token | Value | Use |
|---|---|---|
| `--background` | `oklch(0.971 0.012 85)` | warm cream page |
| `--foreground` | `oklch(0.215 0.018 55)` | warm ink text (~16:1) |
| `--card` | `oklch(0.988 0.009 85)` | page/card surface |
| `--primary` | `oklch(0.5 0.2 33)` | **vermillion** (darkened so small text ≥ AA) |
| `--primary-foreground` | `oklch(0.985 0.008 85)` | text on vermillion |
| `--secondary` / `--muted` | `oklch(0.935 …)` | newsprint-tan fills |
| `--muted-foreground` | `oklch(0.435 0.022 60)` | secondary text only |
| `--accent` | `oklch(0.928 0.03 70)` | hover wash |
| `--destructive` | `oklch(0.535 0.215 28)` | errors / data-warning icon |
| `--border` | `oklch(0.25 0.018 55 / 0.22)` | hairlines |
| `--ring` | = `--primary` | focus |
| `--ink-blue` | `oklch(0.38 0.09 245)` | secondary data tone (e.g. challenger) |
| `--court` | `oklch(0.485 0.13 150)` | **LIVE only** (cream text passes on it) |
| `--newsprint` | `oklch(0.905 0.022 78)` | aged-paper panel |
| `--gold` | `oklch(0.76 0.13 80)` | **champion only** (fills, not small text) |
| `--grain-opacity` | `0.04` | paper grain layer strength |
| `--halftone-color` | `oklch(0.215 0.018 55 / 0.1)` | dot fields |
| `--splash-dot` | `oklch(0.215 0.018 55 / 0.13)` | cover halftone splash |

### Ink — dark night edition (`.dark`)
Deep **near-neutral charcoal** (low chroma so it reads as crisp ink, not muddy
brown), bright cream type, a **lifted/softened vermillion** so the accent isn't
harsh on dark.
| Token | Value |
|---|---|
| `--background` | `oklch(0.155 0.005 65)` |
| `--foreground` | `oklch(0.96 0.008 85)` |
| `--card` | `oklch(0.205 0.006 65)` |
| `--primary` | `oklch(0.73 0.165 40)` (lighter + less chroma than light) |
| `--primary-foreground` | `oklch(0.16 0.01 60)` (ink text on the accent) |
| `--muted-foreground` | `oklch(0.785 0.012 80)` (kept high for readability) |
| `--court` | `oklch(0.72 0.15 152)` |
| `--gold` | `oklch(0.82 0.13 82)` |
| `--border` | `oklch(0.95 0.01 85 / 0.16)` |
| `--grain-opacity` | `0.022` · `--splash-dot` | `oklch(0.95 0.01 85 / 0.1)` |

`@media (prefers-contrast: more)` bumps `--border` alpha in both themes.

---

## 3. Typography

Loaded via Google Fonts in `src/index.css`.

- **`--font-display: Fraunces`** — variable serif (opsz/wght/ital). Headlines and
  **all big numerals** (scores, %, seeds, stats). Set `tabular-nums` for figures.
- **`--font-sans: Archivo`** — body & UI (the default `body` font).
- **`--font-condensed: Archivo`** — used uppercase + tracked for kickers.
- `--font-mono` — fallback only; avoid for new UI.

### Type utilities (classes)
- `.masthead` — Fraunces 900, opsz 144 (the "HOOPER" wordmark).
- `.display` — Fraunces 800, opsz 144 (hero/section headlines).
- `.stat-figure` — Fraunces 800, tabular, opsz 144 (oversized numerals).
- `.kicker` — small-caps eyebrow label: condensed, **0.75rem**, `tracking 0.12em`,
  uppercase, `smcp`. **This replaces all uppercase-mono labels.**
- `.dropcap` — editorial drop cap.

### Rules
- **No essential text below ~0.72rem.** Labels use `.kicker` (or the `<Kicker>`
  component); badges are `0.7rem`.
- **Vermillion (`text-primary`) for text only at large/bold sizes** — never small
  body. Body = `text-foreground`; secondary = `text-muted-foreground`.
- Big numerals: Fraunces + `tabular-nums` (or `.stat-figure`).

---

## 4. Editorial utilities (`src/index.css`, `@layer components`)

| Class | What |
|---|---|
| `.rule` / `.rule-thick` / `.rule-double` | hairline / heavy / broadsheet double rule (vermillion underline) |
| `.halftone` / `.halftone-lg` | CSS radial-dot fields (page detail) |
| `.halftone-fade` | radial mask to dissolve a halftone |
| `.halftone-splash` | **value-graded** halftone "ink tone" bleeding from a corner; color via `--splash-dot`. Used on the homepage cover and (finer, team-colored) on ISO Lab player cards |
| `.grain-layer` | fixed full-bleed paper grain; **mounted once** in `main.tsx` |
| `.duotone` | grayscale/contrast filter for printed headshots |
| `.letterpress` | subtle text emboss |
| `.scrollbar-hide` | hide scrollbar |

**Tinting the splash:** set `--splash-dot` inline (e.g. a team color via
`withAlpha(color, 0.2)`); override `background-size` / dot radius for a finer
screen (ISO cards use `9px` grid vs the cover's `13px`).

---

## 5. Components (`src/components/editorial.tsx`)

- **`<Kicker ruled? tone?>`** — eyebrow label. `tone`: `primary` | `ink` | `muted`
  | `court`. `ruled` adds a leading vermillion tick.
- **`<Rule weight? vertical?>`** — `hair` | `thick` | `double`.
- **`<SectionHeader kicker title lede action rule>`** — standard section head
  (kicker + Fraunces headline + dek + double rule).
- **`<Masthead issue detail>`** — magazine nameplate line.
- **`<StatFigure value label caption size align>`** — big tabular numeral block.
- **`<HalftoneAvatar src alt fallback size accent active>`** — duotone printed
  headshot; `active` un-desaturates + accent border. **Caveat:** it does not set
  `crossOrigin`, so inside the bracket PNG-export tree use the existing
  `Headshot` (crossOrigin) component instead — keep `HalftoneAvatar` outside the
  exported `treeRef`.

### Restyled shadcn primitives (`src/components/ui/`)
- **Button** — `rounded-sm`, semibold, letterpress shadow; `outline` inverts to
  ink on hover; extra `editorial` variant (underline CTA).
- **Card** — flat, hairline border, no shadow, Fraunces `CardTitle`.
- **Badge** — small-caps chip (`0.7rem`); variants `default` (vermillion),
  `secondary`, `destructive`, `outline`, `live` (court), `gold` (champion).
- **Input / Select** — squared (`rounded-sm`).
- **ModeToggle** — segmented **Paper / Ink** sun/moon toggle (no dropdown).

---

## 6. Page patterns

- **Page/section header:** `<Kicker ruled>` + Fraunces headline + muted dek +
  `<Rule weight="double" />`.
- **Nav:** Fraunces title-case links (matches the wordmark), active = vermillion
  + static underline. Not bold-uppercase tabs.
- **Cards / lists:** flat, hairline-separated; winners/edges/leaders in vermillion.
- **Atmosphere:** halftone splash + an oversized faint `VS.` / numeral watermark;
  a "By the Numbers" stat band for honest vertical height. No court lines.
- **Motion:** entrance fades/staggers; respect `prefers-reduced-motion` (global
  guard in `index.css`). The ISO "tip-off" overlay plays **once per matchup**;
  re-runs use a simple spinner.

---

## 7. Accessibility checklist
- Body/headline contrast is AAA; keep `--muted-foreground` no lighter than spec.
- Don't put small body text on `--primary`, `--court`, or `--gold` fills.
- Pair color with another cue (LIVE = court + word + dot; deltas = sign/arrow).
- Focus ring is vermillion (`--ring`); never remove focus visibility.
- Data-limitation warnings are a focusable red info-icon + tooltip (not a box).
