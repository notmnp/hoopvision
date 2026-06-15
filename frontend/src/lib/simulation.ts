// Shared shapes for a single IsoLab simulation result. Defined here (rather than
// inline in Simulator.tsx) so the GOAT Bracket series drill-down can reuse the
// same PlayByPlayView / MatchSummaryView components with matching types.

export type ConfidenceTier = "HIGH" | "MEDIUM" | "LOW"

export interface PlayByPlay {
  possession: number
  offensive_player: string
  shot_type: string
  result: string
  foul: boolean
  turnover: boolean
  score_a: number
  score_b: number
  // Real shot location, sampled from the player's shot chart on the backend.
  // Only present on a field-goal attempt ("made"/"missed"); null on turnovers
  // and drawn fouls. Labels match the shared court's ZONE_POSITIONS keys.
  shot_zone_basic?: string | null
  shot_zone_area?: string | null
}

export interface PlayerSimStats {
  points: number
  shooting_percentage: number
  three_point_percentage: number
  shot_type_distribution: {
    rim: number
    mid_range: number
    three: number
  }
  shot_type_percentage: {
    rim: number
    mid_range: number
    three: number
  }
  turnovers: number
  fouls_drawn: number
  confidence_tier?: ConfidenceTier
}

export interface MatchSummary {
  winner: string
  final_score: {
    a: number
    b: number
  }
  player_stats: Record<string, PlayerSimStats>
  data_warnings: string[]
}

export interface SimulationResult {
  play_by_play: PlayByPlay[]
  // Player A's model-derived win probability after each possession (0–1), one
  // per play. Computed by the backend from the players' tendency profiles; it
  // only reaches 1/0 once a player has actually reached 21.
  win_probability?: number[]
  summary: MatchSummary
}
