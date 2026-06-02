// Shared GOAT Bracket contracts, mirroring the API Server's bracket models
// (backend/app/bracket.py). Consumed by BracketSetupController, BracketView, and
// BracketExporter.

import { API_BASE_URL } from "@/lib/config"
import { SimulationResult } from "@/lib/simulation"

export type { SimulationResult }

export type PossessionMode = "make_it_take_it" | "alternating"
export type BracketSize = 4 | 8 | 16
export type SeriesFormat = 1 | 3 | 5 | 7
export type BracketStatus = "SETUP" | "IN_PROGRESS" | "COMPLETE"

export interface BracketParticipant {
  player_id: number
  season_id: string
  seed: number
  name?: string | null
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

// A setup-phase participant slot, indexed positionally by seed (slot index 0 is
// seed 1, ADR-003). A slot is "ready" once it has both a player and a season;
// the bracket can only be simulated when every slot is ready.
export interface BracketSlot {
  player_id: number | null
  name: string | null
  season_id: string | null
}

export const EMPTY_SLOT: BracketSlot = {
  player_id: null,
  name: null,
  season_id: null,
}

export function emptySlots(size: number): BracketSlot[] {
  return Array.from({ length: size }, () => ({ ...EMPTY_SLOT }))
}

export function isSlotReady(slot: BracketSlot): boolean {
  return slot.player_id !== null && slot.season_id !== null
}

// Routed through the API's headshot proxy rather than hitting cdn.nba.com
// directly: the CDN sends no CORS headers, so a crossOrigin="anonymous" <img>
// (required so the bracket PNG export's canvas isn't tainted) can only load the
// photo via our own CORS-enabled origin.
export function headshotUrl(playerId: number): string {
  return `${API_BASE_URL}/headshot/${playerId}`
}

// "Best of 7" / "Final" etc. for a round, given how many rounds remain.
export function roundName(roundNumber: number, totalRounds: number): string {
  const fromEnd = totalRounds - roundNumber
  if (fromEnd === 0) return "Final"
  if (fromEnd === 1) return "Semifinals"
  if (fromEnd === 2) return "Quarterfinals"
  return `Round ${roundNumber}`
}

// First-round seed slot order for a single-elimination bracket, built by the
// classic recursive mirroring so the top seeds are spread across the tree and
// the two best seeds can only meet in the final. Mirrors the backend's
// `standard_seed_order` (bracket.py) — for size 8 this is [1,8,4,5,2,7,3,6],
// whose consecutive pairs are the first-round matchups.
export function standardSeedOrder(bracketSize: number): number[] {
  let seeds = [1]
  while (seeds.length < bracketSize) {
    const slotCount = seeds.length * 2
    const mirrored: number[] = []
    for (const seed of seeds) {
      mirrored.push(seed)
      mirrored.push(slotCount + 1 - seed)
    }
    seeds = mirrored
  }
  return seeds
}

// A display label for a participant: their name, falling back to the season or
// player id when the name hasn't been resolved yet.
export function participantLabel(participant: {
  name?: string | null
  player_id: number
}): string {
  return participant.name ?? `Player #${participant.player_id}`
}

// A compact label for tight slots: the last name only (e.g. "Gilgeous-Alexander"
// from "Shai Gilgeous-Alexander"). Single-token names and unresolved players
// fall back to the full participant label so nothing renders blank.
export function participantLastName(participant: {
  name?: string | null
  player_id: number
}): string {
  const full = participantLabel(participant)
  if (!participant.name) return full
  const tokens = participant.name.trim().split(/\s+/).filter(Boolean)
  return tokens.length > 1 ? tokens[tokens.length - 1] : full
}
