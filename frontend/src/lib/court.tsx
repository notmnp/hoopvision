import { ReactElement } from "react"

// Shared LANDSCAPE half-court geometry for the live broadcast and the shot
// chart. The hoop sits near the LEFT baseline; play extends to the right toward
// the 3-point arc. viewBox is 564 wide × 400 tall. Kept in one place so the
// broadcast court and the Tendency Explorer chart agree.
export const COURT_W = 564
export const COURT_H = 400
export const COURT_VIEWBOX = `0 0 ${COURT_W} ${COURT_H}`

// The rim, in court coordinates — where every shot arc terminates (left side).
// Tucked right up against the left baseline (backboard just off it, rim in
// front), so the basket never reads as sitting out in the paint.
export const HOOP = { x: 26, y: 200 }

// Rim radius — shared so the make "net flash" overlay lines up with the drawn rim.
export const RIM_R = 8

// Where each player "lives" between actions, out near the arc on their own
// sideline. The ball departs from and returns toward these so possession is
// spatial. a = top sideline, b = bottom sideline.
export const PLAYER_HOME: Record<"a" | "b", { x: number; y: number }> = {
  a: { x: 432, y: 120 },
  b: { x: 432, y: 280 },
}

// Approximate landscape position for each NBA shot zone, keyed by
// `${SHOT_ZONE_BASIC}|${SHOT_ZONE_AREA}` (the labels the backend emits). x grows
// from the rim (left) out to the arc (right); y spans sideline to sideline.
export const ZONE_POSITIONS: Record<string, { x: number; y: number }> = {
  "Restricted Area|Center(C)": { x: 78, y: 200 },
  "In The Paint (Non-RA)|Center(C)": { x: 182, y: 200 },
  "In The Paint (Non-RA)|Left Side(L)": { x: 168, y: 164 },
  "In The Paint (Non-RA)|Right Side(R)": { x: 168, y: 236 },
  "Mid-Range|Center(C)": { x: 264, y: 200 },
  "Mid-Range|Left Side(L)": { x: 180, y: 88 },
  "Mid-Range|Left Side Center(LC)": { x: 264, y: 136 },
  "Mid-Range|Right Side Center(RC)": { x: 264, y: 264 },
  "Mid-Range|Right Side(R)": { x: 180, y: 312 },
  "Left Corner 3|Left Side(L)": { x: 96, y: 40 },
  "Right Corner 3|Right Side(R)": { x: 96, y: 360 },
  // Just OUTSIDE the arc (semicircle: centre (150,200), r=170, apex (320,200)),
  // not floated far past it — these sit a hair beyond the line where the shot
  // was actually taken.
  "Above the Break 3|Left Side Center(LC)": { x: 302, y: 104 },
  "Above the Break 3|Center(C)": { x: 340, y: 200 },
  "Above the Break 3|Right Side Center(RC)": { x: 302, y: 296 },
}

export type ShotBand = "rim" | "mid_range" | "three"

const BAND_ANCHORS: Record<ShotBand, { x: number; y: number }> = {
  rim: { x: 88, y: 200 },
  mid_range: { x: 264, y: 200 },
  three: { x: 340, y: 200 },
}

// Classify a SHOT_ZONE_BASIC label into a band — mirrors the backend's
// _shot_type_from_zone so the fallback anchor matches the shot's band.
export function bandFromBasic(basic: string | null | undefined): ShotBand {
  const text = (basic ?? "").toLowerCase()
  if (text.includes("3")) return "three"
  if (text.includes("restricted") || text.includes("paint")) return "rim"
  return "mid_range"
}

// Two decorrelated pseudo-randoms in [-1, 1) from one integer seed. Deterministic
// so a given possession's shot keeps the same spot across replays and scrubs.
function jitter(seed: number): [number, number] {
  const a = Math.sin((seed + 1) * 12.9898) * 43758.5453
  const b = Math.sin((seed + 1) * 78.233 + 1.3) * 24634.6345
  return [(a - Math.floor(a) - 0.5) * 2, (b - Math.floor(b) - 0.5) * 2]
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

// A point on a quadratic Bézier (used to ride the shot arc without SMIL).
export function quadAt(
  p0: { x: number; y: number },
  c: { x: number; y: number },
  p1: { x: number; y: number },
  t: number
): { x: number; y: number } {
  const u = 1 - t
  return {
    x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x,
    y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y,
  }
}

// Deterministic court coordinate for a single shot. The zone (basic/area) is the
// real, data-driven part; the seeded jitter only spreads multiple shots within a
// zone so they don't stack on one dot.
export function shotPoint(
  basic: string | null | undefined,
  area: string | null | undefined,
  seed: number
): { x: number; y: number } {
  const base =
    ZONE_POSITIONS[`${basic ?? ""}|${area ?? ""}`] ??
    BAND_ANCHORS[bandFromBasic(basic)]
  const [jx, jy] = jitter(seed)
  return {
    x: clamp(base.x + jx * 18, 22, COURT_W - 22),
    y: clamp(base.y + jy * 26, 22, COURT_H - 22),
  }
}

// The quadratic control point of a shot's arc: a distance-aware lob that lifts
// toward the top of the screen and drops steeply into the left rim.
export function arcControl(
  x: number,
  y: number
): { x: number; y: number } {
  const distance = Math.hypot(HOOP.x - x, HOOP.y - y)
  const lift = Math.min(150, 60 + distance * 0.42)
  return { x: x + (HOOP.x - x) * 0.42, y: Math.min(y, HOOP.y) - lift }
}

// Stylized landscape half-court: outer bound, the paint/key (extending right
// from the left baseline), free-throw circle, the 3-point line (corners + arc
// bulging right), the rim, and the backboard. Every stroke uses
// non-scaling-stroke so the line weight is a fixed pixel value at any rendered
// size (the SVG usually scales UP, which would otherwise fatten the lines).
// 1.4px reads a touch heavier than a pure hairline so the diagram holds its own
// against the shot marks. vectorEffect doesn't inherit, so it's set per shape.
const COURT_STROKE = 1.4
export function CourtLines(): ReactElement {
  return (
    <g
      fill="none"
      stroke="currentColor"
      strokeWidth={COURT_STROKE}
      strokeLinejoin="round"
      strokeLinecap="round"
      className="text-foreground/20"
    >
      {/* No outer boundary rect here — the court's frame is the single hairline
          border on the container that wraps this SVG, so drawing one here too
          would double it up. */}

      {/* the key / paint — its left edge IS the baseline, so it starts at x=0
          flush with the container's border (right edge = FT line at x=192), with
          a whisper of ink tint so it reads as a printed floor area */}
      <rect
        x={0}
        y={138}
        width={192}
        height={124}
        fill="currentColor"
        fillOpacity={0.16}
        vectorEffect="non-scaling-stroke"
      />

      {/* Free-throw circle on the FT line (x=192), realistically proportioned
          (r=46 ≈ 12ft circle vs the 16ft lane). The outer (toward half-court)
          half is solid; the half inside the paint is dashed — the real-court
          convention — and kept visible enough that the eye reads a full circle.
          Center (192,200) → top/bottom at (192,154)/(192,246). */}
      <path d="M 192 154 A 46 46 0 0 1 192 246" vectorEffect="non-scaling-stroke" />
      <path
        d="M 192 154 A 46 46 0 0 0 192 246"
        strokeDasharray="6 5"
        className="text-foreground/15"
        vectorEffect="non-scaling-stroke"
      />

      {/* 3-point line: straight corner segments from the left baseline out to the
          break points (150,30)/(150,370), then a clean semicircle bulging toward
          half-court. Because the break points are the semicircle's diameter ends,
          its tangent there is horizontal — so the corner segments and the arc meet
          SMOOTHLY (no kink), and a minor arc never swings off the floor the way the
          previous oversized major arc did. Apex (320,200), clear of the FT circle. */}
      <path d="M 0 30 L 150 30 A 170 170 0 0 1 150 370 L 0 370" vectorEffect="non-scaling-stroke" />

      {/* Basket (left), in true plan view — this is a bird's-eye diagram, so
          the basket is just the backboard line (just off the baseline), a short
          rim neck, and the rim circle. No draping net: that's a side-on detail
          that would break the top-down perspective. Same 1px hairline weight as
          every other line — only a touch darker so the target still anchors the
          diagram (emphasis via tone, never thickness, per the design norm). */}
      <path
        d={`M 14 178 L 14 222 M 14 200 L ${HOOP.x - RIM_R} 200`}
        className="text-foreground/45"
        strokeWidth={COURT_STROKE + 0.4}
        vectorEffect="non-scaling-stroke"
      />
      <circle
        cx={HOOP.x}
        cy={HOOP.y}
        r={RIM_R}
        className="text-foreground/50"
        strokeWidth={COURT_STROKE + 0.4}
        vectorEffect="non-scaling-stroke"
      />
    </g>
  )
}
