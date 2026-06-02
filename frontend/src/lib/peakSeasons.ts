// The canonical "signature" season per legend — the year a matchup should
// default to when a player is dropped in without an explicit season choice.
// Keyed by the exact player name the /players/search index returns; values are
// `season_id` strings ("YYYY-YY"), the same format the bracket field presets use.
//
// This is the single source of truth shared by the homepage debate deep-links,
// the ISO Lab sample bout, and the Random-matchup rivalries, so every entry
// point agrees on the canonical season instead of falling back to whatever the
// player's most recent year happens to be. (The bracket field presets carry
// their own per-seed seasons in BracketSetup.) Unknown names return `undefined`,
// and a requested season that a player doesn't actually have falls back to their
// most recent season, so a wrong/missing entry degrades gracefully.
export const PEAK_SEASONS: Record<string, string> = {
  "Michael Jordan": "1995-96",
  "LeBron James": "2017-18",
  "Kobe Bryant": "2005-06",
  "Kevin Durant": "2013-14",
  "Stephen Curry": "2015-16",
  "Magic Johnson": "1986-87",
  "Allen Iverson": "2000-01",
  "Kyrie Irving": "2020-21",
  "Shaquille O'Neal": "1999-00",
  "Nikola Jokic": "2023-24",
  "Hakeem Olajuwon": "1993-94",
  "Giannis Antetokounmpo": "2019-20",
  "Larry Bird": "1985-86",
  "Dwyane Wade": "2008-09",
}

/** The signature season_id for a player name, or undefined when unmapped. */
export function peakSeason(name: string): string | undefined {
  return PEAK_SEASONS[name]
}
