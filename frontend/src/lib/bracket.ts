// Shared GOAT Bracket contracts, mirroring the API Server's bracket models
// (backend/app/bracket.py). Consumed by BracketSetupController, BracketView, and
// BracketExporter.

export type PossessionMode = "make_it_take_it" | "alternating"
export type BracketSize = 4 | 8 | 16
export type SeriesFormat = 1 | 3 | 5 | 7
export type BracketStatus = "SETUP" | "IN_PROGRESS" | "COMPLETE"

export interface BracketParticipant {
  player_id: number
  season_id: string
  seed: number
}

export interface BracketConfig {
  participants: BracketParticipant[]
  bracket_size: BracketSize
  series_format: SeriesFormat
  possession_mode?: PossessionMode
}

export interface SeriesWins {
  a: number
  b: number
}

// One game's result, matching SimulationEngine.simulate(). Kept loose on the
// inner shapes the bracket UI doesn't itself read; the series drill-down reuses
// IsoLab's own PlayByPlay/MatchSummary views for the detail.
export interface SimulationResult {
  play_by_play: PlayByPlay[]
  summary: MatchSummary
}

export interface PlayByPlay {
  possession: number
  offensive_player: string
  shot_type: string
  result: string
  foul: boolean
  turnover: boolean
  score_a: number
  score_b: number
}

export interface MatchSummary {
  winner: string
  final_score: { a: number; b: number }
  player_stats: Record<string, unknown>
  data_warnings: string[]
}

export interface BracketMatchup {
  seed_a: number | null
  seed_b: number | null
  player_a: BracketParticipant | null
  player_b: BracketParticipant | null
  series_wins: SeriesWins
  games: SimulationResult[]
  winner: BracketParticipant | null
}

export interface BracketRound {
  round_number: number
  matchups: BracketMatchup[]
}

export interface BracketState {
  bracket_id: string
  bracket_size: number
  series_format: number
  status: BracketStatus
  rounds: BracketRound[]
  champion?: BracketParticipant | null
}

export const BRACKET_SIZES: BracketSize[] = [4, 8, 16]
export const SERIES_FORMATS: SeriesFormat[] = [1, 3, 5, 7]

export function headshotUrl(playerId: number): string {
  return `https://cdn.nba.com/headshots/nba/latest/1040x760/${playerId}.png`
}

// "Best of 7" / "Final" etc. for a round, given how many rounds remain.
export function roundName(roundNumber: number, totalRounds: number): string {
  const fromEnd = totalRounds - roundNumber
  if (fromEnd === 0) return "Final"
  if (fromEnd === 1) return "Semifinals"
  if (fromEnd === 2) return "Quarterfinals"
  return `Round ${roundNumber}`
}
