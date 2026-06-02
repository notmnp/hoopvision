# Hooper frontend

React + Vite + TypeScript + Tailwind v4 + shadcn/ui.

## Design system — read this before touching UI
The visual identity is **"The Matchup Issue"** — an editorial basketball-almanac
look. The full reference is **[DESIGN.md](./DESIGN.md)**. Source of truth in code:
- `src/index.css` — OKLCH theme tokens (Paper = light default, Ink = dark) +
  editorial utilities (`.kicker`, `.rule`, `.halftone*`, `.stat-figure`, …).
- `src/components/editorial.tsx` — `Kicker`, `Rule`, `SectionHeader`, `StatFigure`,
  `HalftoneAvatar`.
- `src/components/ui/` — restyled shadcn primitives.

### Non-negotiables (see DESIGN.md for the rest)
- One accent: **vermillion** (`--primary`). Gold = champion only; court-green =
  LIVE only. No purple, no glassmorphism, **no literal court-line backdrop**.
- Fonts: **Fraunces** (display + all numerals, `tabular-nums`) + **Archivo** (body);
  labels use the `.kicker` class, not uppercase-mono.
- Squared corners (`--radius: 0.25rem`), flat hairline-bordered cards, double-rule
  dividers; atmosphere via halftone dots / grain, not patterns over text.
- No essential text < ~0.72rem; vermillion text only at large/bold sizes.
- Respect `prefers-reduced-motion`.

## Checks
- Typecheck: `npx tsc -b --noEmit`
- Build: `npm run build`
