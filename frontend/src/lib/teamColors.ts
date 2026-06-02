// One brand color per NBA franchise, keyed by the TEAM_ABBREVIATION the stats
// API returns. These are *editorial* variants of the official brands, not the
// raw digital hexes: each was converted to OKLCH, had its chroma capped well
// below the vermillion star accent (~0.115 vs the accent's 0.2) and its
// lightness pulled toward the accent's mid-tone, then converted back. Hue is
// preserved exactly, so every team still reads as itself (Celtics green, Lakers
// purple, Knicks orange) but as a muted printed ink that sits in the same
// warm-paper world as the rest of the palette instead of clashing with it.
// Same-family neighbors (the league's many reds/navies) are unavoidable; the
// team logo + abbreviation disambiguate those. Unmapped abbreviations fall back
// to `null` (the card renders without a team accent). To retune, edit the raw
// brand hexes + muting constants in the generator and regenerate.
const TEAM_PRIMARY_COLORS: Record<string, string> = {
  // Current franchises
  ATL: "#B15A55", // brick red
  BOS: "#2C7840", // green
  BKN: "#484848", // charcoal
  CHA: "#00778B", // teal
  CHI: "#A54E55", // red
  CLE: "#863349", // wine
  DAL: "#355FA0", // royal blue
  DEN: "#BE9940", // gold
  DET: "#A34C4C", // red
  GSW: "#2E5192", // navy blue
  HOU: "#9D4749", // deep red
  IND: "#1C477F", // navy
  LAC: "#B2595F", // red
  LAL: "#5F3E84", // purple
  MEM: "#5871A3", // steel blue
  MIA: "#8E3A43", // maroon
  MIL: "#1A592C", // forest green
  MIN: "#286697", // lake blue
  NOP: "#816D49", // gold/tan
  NYK: "#C47A46", // orange
  OKC: "#2A75AE", // sky blue
  ORL: "#2B74AD", // magic blue
  PHI: "#2A6CA7", // blue
  PHX: "#B96746", // orange
  POR: "#9B4640", // red
  SAC: "#644086", // purple
  SAS: "#7C7F81", // silver
  TOR: "#A54E55", // red
  UTA: "#1F487B", // navy
  WAS: "#AE5655", // red
  // Historical / relocated
  NJN: "#1E477F", // New Jersey Nets
  NOH: "#00778C", // New Orleans Hornets (teal)
  NOK: "#00778C", // New Orleans/Oklahoma City Hornets
  CHH: "#0084A0", // Charlotte Hornets (original teal)
  SEA: "#126D42", // Seattle SuperSonics
  VAN: "#009D95", // Vancouver Grizzlies
  WSB: "#28477A", // Washington Bullets
  KCK: "#644086", // Kansas City Kings
  SDC: "#B2595F", // San Diego Clippers
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
