import { ReactElement } from "react"

// Shared LANDSCAPE half-court geometry for the live broadcast and the shot
// chart. The hoop sits near the LEFT baseline; play extends to the right toward
// the 3-point arc. viewBox is 564 wide × 400 tall. Kept in one place so the
// broadcast court and the Tendency Explorer chart agree.
export const COURT_W = 564
export const COURT_H = 400
export const COURT_VIEWBOX = `0 0 ${COURT_W} ${COURT_H}`

// The rim, in court coordinates — where every shot arc terminates (left side).
// Pulled back toward the baseline so the hoop reads as the target a shot drops
// INTO, rather than sitting out in front of the floor.
export const HOOP = { x: 56, y: 200 }

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
  "Restricted Area|Center(C)": { x: 98, y: 200 },
  "In The Paint (Non-RA)|Center(C)": { x: 182, y: 200 },
  "In The Paint (Non-RA)|Left Side(L)": { x: 168, y: 164 },
  "In The Paint (Non-RA)|Right Side(R)": { x: 168, y: 236 },
  "Mid-Range|Center(C)": { x: 264, y: 200 },
  "Mid-Range|Left Side(L)": { x: 180, y: 88 },
  "Mid-Range|Left Side Center(LC)": { x: 264, y: 136 },
  "Mid-Range|Right Side Center(RC)": { x: 264, y: 264 },
  "Mid-Range|Right Side(R)": { x: 180, y: 312 },
  "Left Corner 3|Left Side(L)": { x: 94, y: 34 },
  "Right Corner 3|Right Side(R)": { x: 94, y: 366 },
  "Above the Break 3|Left Side Center(LC)": { x: 384, y: 88 },
  "Above the Break 3|Center(C)": { x: 432, y: 200 },
  "Above the Break 3|Right Side Center(RC)": { x: 384, y: 312 },
}

// The net hanging beneath the rim, built once at module load. Eleven cords drape
// from the rim's mouth (its full width, at HOOP.y) down to a smaller bottom ring,
// crossed by three weave rows — the classic tapering-net silhouette that reads as
// a real net even at this small scale, rather than a bare ring. Drawn in HOOP-
// centered court coordinates so it sits exactly under the rim every shot drops into.
const NET = (() => {
  const R = RIM_R
  const drop = R * 1.9 // how far the net hangs below the rim
  const botR = R * 0.5 // radius of the cinched bottom opening
  const cords = 11
  let mesh = ""
  for (let i = 0; i < cords; i++) {
    const t = i / (cords - 1)
    const topX = HOOP.x - R + 2 * R * t
    const botX = HOOP.x - botR + 2 * botR * t
    mesh += `M ${topX.toFixed(1)} ${HOOP.y} Q ${((topX + botX) / 2).toFixed(1)} ${(
      HOOP.y +
      drop * 0.6
    ).toFixed(1)} ${botX.toFixed(1)} ${(HOOP.y + drop).toFixed(1)} `
  }
  for (let r = 1; r <= 3; r++) {
    const y = HOOP.y + drop * (r / 4)
    const rr = R - (R - botR) * (r / 4)
    mesh += `M ${(HOOP.x - rr).toFixed(1)} ${y.toFixed(1)} Q ${HOOP.x} ${(y + 5).toFixed(
      1
    )} ${(HOOP.x + rr).toFixed(1)} ${y.toFixed(1)} `
  }
  return mesh.trim()
})()

export type ShotBand = "rim" | "mid_range" | "three"

const BAND_ANCHORS: Record<ShotBand, { x: number; y: number }> = {
  rim: { x: 108, y: 200 },
  mid_range: { x: 264, y: 200 },
  three: { x: 420, y: 200 },
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

export function lerp(
  a: { x: number; y: number },
  b: { x: number; y: number },
  t: number
): { x: number; y: number } {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
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

// The shot arc as an SVG quadratic path from a launch point to the rim.
export function arcPath(x: number, y: number): string {
  const c = arcControl(x, y)
  return `M ${x} ${y} Q ${c.x} ${c.y} ${HOOP.x} ${HOOP.y}`
}

// Stylized landscape half-court: outer bound, the paint/key (extending right
// from the left baseline), free-throw circle, the 3-point line (corners + arc
// bulging right), the rim, and the backboard.
export function CourtLines(): ReactElement {
  return (
    <g
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinejoin="round"
      strokeLinecap="round"
      className="text-foreground/25"
    >
      {/* outer boundary */}
      <rect x={2} y={2} width={560} height={396} rx={4} />

      {/* the key / paint, from the left baseline (right edge = FT line at x=192) */}
      <rect x={2} y={138} width={190} height={124} />

      {/* Free-throw circle on the FT line (x=192), realistically proportioned
          (r=46 ≈ 12ft circle vs the 16ft lane). The outer (toward half-court)
          half is solid; the half inside the paint is dashed — the real-court
          convention — and kept visible enough that the eye reads a full circle.
          Center (192,200) → top/bottom at (192,154)/(192,246). */}
      <path d="M 192 154 A 46 46 0 0 1 192 246" />
      <path
        d="M 192 154 A 46 46 0 0 0 192 246"
        strokeDasharray="6 5"
        className="text-foreground/20"
      />

      {/* 3-point line: straight corner segments from the left baseline out to the
          break points (150,30)/(150,370), then a clean semicircle bulging toward
          half-court. Because the break points are the semicircle's diameter ends,
          its tangent there is horizontal — so the corner segments and the arc meet
          SMOOTHLY (no kink), and a minor arc never swings off the floor the way the
          previous oversized major arc did. Apex (320,200), clear of the FT circle. */}
      <path d="M 2 30 L 150 30 A 170 170 0 0 1 150 370 L 2 370" />

      {/* Basket (left): backboard, a short rim neck, the rim, and a hanging net,
          drawn as one attached unit. Backboard at x=42; neck runs to the rim's
          left edge. The net (NET, built above) drapes from the rim mouth so the
          hoop reads as a real basket rather than a bare ring. The rim is a
          slightly flattened ellipse — a hint of the broadcast tilt's dimension. */}
      <path
        d={`M 42 178 L 42 222 M 42 200 L ${HOOP.x - RIM_R} 200`}
        className="text-foreground/50"
        strokeWidth={2.5}
      />
      <path d={NET} className="text-foreground/30" strokeWidth={0.8} />
      <ellipse
        cx={HOOP.x}
        cy={HOOP.y}
        rx={RIM_R}
        ry={RIM_R * 0.78}
        className="text-foreground/55"
        strokeWidth={2.4}
      />
    </g>
  )
}
