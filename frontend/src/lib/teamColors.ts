// One brand color per NBA franchise, keyed by the TEAM_ABBREVIATION the stats
// API returns. Where the official primaries collide (the league has many reds
// and navies), a recognizable secondary is used instead so that no two teams
// share a value and the palette spreads across the hue wheel as much as the
// real brands allow — e.g. Hornets teal, Nuggets gold, Knicks orange, Wizards
// red, Spurs silver. Some same-family neighbors (multiple reds/blues) are
// unavoidable; the team logo + abbreviation disambiguate those. Unmapped
// abbreviations fall back to `null` (the card renders without a team accent).
const TEAM_PRIMARY_COLORS: Record<string, string> = {
  // Current franchises
  ATL: "#E03A3E", // red
  BOS: "#007A33", // green
  BKN: "#000000", // black
  CHA: "#00788C", // teal
  CHI: "#CE1141", // red
  CLE: "#860038", // wine
  DAL: "#0053BC", // royal blue
  DEN: "#FEC524", // gold
  DET: "#C8102E", // red
  GSW: "#1D428A", // navy blue
  HOU: "#BA0C2F", // deep red
  IND: "#002D62", // navy
  LAC: "#ED174C", // red
  LAL: "#552583", // purple
  MEM: "#5D76A9", // steel blue
  MIA: "#98002E", // maroon
  MIL: "#00471B", // forest green
  MIN: "#236192", // lake blue
  NOP: "#85714D", // gold/tan
  NYK: "#F58426", // orange
  OKC: "#007AC1", // sky blue
  ORL: "#0077C0", // magic blue
  PHI: "#006BB6", // blue
  PHX: "#E56020", // orange
  POR: "#B5121B", // red
  SAC: "#5A2D81", // purple
  SAS: "#8A8D8F", // silver
  TOR: "#CE1141", // red
  UTA: "#002B5C", // navy
  WAS: "#E31837", // red
  // Historical / relocated
  NJN: "#002A60", // New Jersey Nets
  NOH: "#00778C", // New Orleans Hornets (teal)
  NOK: "#00778C", // New Orleans/Oklahoma City Hornets
  CHH: "#008CA8", // Charlotte Hornets (original teal)
  SEA: "#00653A", // Seattle SuperSonics
  VAN: "#00B2A9", // Vancouver Grizzlies
  WSB: "#0E2B5C", // Washington Bullets
  KCK: "#5A2D81", // Kansas City Kings
  SDC: "#ED174C", // San Diego Clippers
}

/** Primary brand color for a team abbreviation, or null when unmapped/TOT. */
export function getTeamColor(abbreviation: string | null | undefined): string | null {
  if (!abbreviation) return null
  return TEAM_PRIMARY_COLORS[abbreviation.toUpperCase()] ?? null
}

/** Official NBA logo URL for a team id, or null when the id is unknown (e.g. TOT). */
export function getTeamLogoUrl(teamId: number | null | undefined): string | null {
  if (!teamId || teamId <= 0) return null
  return `https://cdn.nba.com/logos/nba/${teamId}/global/L/logo.svg`
}

/** Append an 8-bit alpha to a #rrggbb hex (e.g. alphaHex("#fff…", 0.14)). */
export function withAlpha(hex: string, alpha: number): string {
  const clamped = Math.max(0, Math.min(1, alpha))
  const byte = Math.round(clamped * 255)
    .toString(16)
    .padStart(2, "0")
  return `${hex}${byte}`
}
