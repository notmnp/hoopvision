// Shared shot-efficiency color helpers — the cool→hot FG% ramp used by the
// Tendency Explorer shot chart and the live court's zone-heat overlay.

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function mix(a: number[], b: number[], t: number): number[] {
  return a.map((value, index) => Math.round(value + (b[index] - value) * t))
}

// Map FG% to a muted-ink → vermillion gradient across a realistic 20%–60% band:
// cold shooting reads as muted ink, a hot clip reads as editorial vermillion.
export function efficiencyColor(fgPct: number): string {
  const t = clamp((fgPct - 0.2) / (0.6 - 0.2), 0, 1)
  const cold = [120, 113, 108]
  const vermillion = [225, 74, 47]
  const rgb = mix(cold, vermillion, t)
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`
}

// Tint a single player's zone by their FG% in their own accent color: cold = a
// muted wash of the accent, hot = the full accent. Keeps each player's heat in
// their identity color rather than a shared ramp.
export function accentHeat(fgPct: number, accentRgb: number[]): string {
  const t = clamp((fgPct - 0.2) / (0.6 - 0.2), 0, 1)
  const cold = [168, 162, 158]
  const rgb = mix(cold, accentRgb, t)
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`
}

export function hexToRgb(hex: string): [number, number, number] {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return [225, 74, 47]
  const int = parseInt(match[1], 16)
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255]
}

export function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

// --- Traffic-light efficiency grading (shared stat-graphic palette) ---
// Muted, print-friendly tones — basil green / warm ochre / brick red — used as
// STAT-GRAPHIC fills (not UI accents), the one sanctioned multi-hue exception to
// the single-accent rule. Per-band thresholds because a good three (~37%) and a
// good rim finish (~60%) sit at very different rates.
export type ShotBandKey = "rim" | "mid_range" | "three"

export interface ZoneColor {
  fill: string
  stroke: string
}

export const ZONE_THRESHOLDS: Record<ShotBandKey, { ok: number; good: number }> = {
  rim: { ok: 0.45, good: 0.6 },
  mid_range: { ok: 0.33, good: 0.42 },
  three: { ok: 0.3, good: 0.37 },
}

export const ZONE_COLORS = {
  good: { fill: "rgba(74,140,82,0.32)", stroke: "rgba(74,140,82,0.66)" },
  ok: { fill: "rgba(196,150,46,0.32)", stroke: "rgba(196,150,46,0.70)" },
  poor: { fill: "rgba(198,72,50,0.30)", stroke: "rgba(198,72,50,0.64)" },
  none: { fill: "rgba(120,113,108,0.10)", stroke: "rgba(120,113,108,0.30)" },
} satisfies Record<string, ZoneColor>

export function gradeZone(band: ShotBandKey, pct: number, attempts: number): ZoneColor {
  if (attempts === 0) return ZONE_COLORS.none
  const { ok, good } = ZONE_THRESHOLDS[band]
  if (pct >= good) return ZONE_COLORS.good
  if (pct >= ok) return ZONE_COLORS.ok
  return ZONE_COLORS.poor
}
