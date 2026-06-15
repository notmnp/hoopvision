// Shared shot-efficiency helpers — the per-band traffic-light zone grading used
// by the Tendency Explorer shot map (Simulator) and the live court's zone-heat
// overlay (BroadcastStrip).

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
