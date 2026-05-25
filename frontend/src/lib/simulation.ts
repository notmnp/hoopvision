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
  summary: MatchSummary
}
