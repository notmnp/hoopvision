// Shared types, constants, and API helpers for the All-Time Draft Challenge.
// The whole draft session lives client-side (ADR-002); the only server calls are
// the read-only spinner/pool endpoints and the final POST /draft/score.

import axios from "axios"
import { API_BASE_URL } from "@/lib/config"

export type PositionSlot = "PG" | "SG" | "SF" | "PF" | "C"

// Court order: PG, SG, SF, PF, C — the slot sequence used everywhere.
export const SLOT_ORDER: PositionSlot[] = ["PG", "SG", "SF", "PF", "C"]

export interface DraftEra {
  id: string
  label: string
  start_year: number
  end_year: number
}

export interface DraftFranchise {
  id: string
  name: string
  abbreviation: string
}

export interface PlayerPoolStats {
  ppg: number
  apg: number
  rpg: number
  ws_per_48: number
  bpm: number
}

export interface PlayerPoolEntry {
  player_id: number
  season_id: string
  name: string
  positions: string[]
  stats: PlayerPoolStats
}

export interface PlayerPool {
  era: string
  franchise: string
  players: PlayerPoolEntry[]
}

// The pool endpoint returns either a pool or an auto-respin signal.
export type PoolResponse = PlayerPool | { auto_respin: true }

export function isAutoRespin(
  response: PoolResponse
): response is { auto_respin: true } {
  return (response as { auto_respin?: boolean }).auto_respin === true
}

// One filled-or-empty slot on the court board.
export interface DraftPick {
  player: PlayerPoolEntry
  eraId: string
  eraLabel: string
  franchiseId: string
  franchiseName: string
}

export interface DraftSlot {
  position: PositionSlot
  pick: DraftPick | null
}

export interface DraftScoreMetrics {
  ws_per_48: number
  bpm: number
  vorp: number
  ts_pct: number
}

export interface DraftScoreBreakdown {
  player_id: number
  name: string
  position_slot: string
  contribution_score: number
  metrics: DraftScoreMetrics
}

export interface DraftScore {
  wins: number
  losses: number
  breakdown: DraftScoreBreakdown[]
}

export interface DraftLineupPayloadPlayer {
  player_id: number
  season_id: string
  position_slot: PositionSlot
}

/** A fresh, empty five-slot lineup in court order. */
export function emptyLineup(): DraftSlot[] {
  return SLOT_ORDER.map((position) => ({ position, pick: null }))
}

/** Combo key for spin-history dedup, e.g. "1990s|bulls". */
export function comboKey(eraId: string, franchiseId: string): string {
  return `${eraId}|${franchiseId}`
}

/** Open slots whose position the player is eligible to fill. */
export function eligibleOpenSlots(
  lineup: DraftSlot[],
  player: PlayerPoolEntry
): PositionSlot[] {
  return lineup
    .filter((slot) => slot.pick === null && player.positions.includes(slot.position))
    .map((slot) => slot.position)
}

/** True when the player has no open slot they can legally fill. */
export function isPlayerUnselectable(
  lineup: DraftSlot[],
  player: PlayerPoolEntry
): boolean {
  return eligibleOpenSlots(lineup, player).length === 0
}

// --- API ------------------------------------------------------------------

export async function fetchEras(): Promise<DraftEra[]> {
  const response = await axios.get<{ eras: DraftEra[] }>(
    `${API_BASE_URL}/draft/eras`
  )
  return response.data.eras
}

export async function fetchFranchises(eraId: string): Promise<DraftFranchise[]> {
  const response = await axios.get<{ franchises: DraftFranchise[] }>(
    `${API_BASE_URL}/draft/franchises`,
    { params: { era: eraId } }
  )
  return response.data.franchises
}

export async function fetchPool(
  eraId: string,
  franchiseId: string,
  excludeIds: number[]
): Promise<PoolResponse> {
  const response = await axios.get<PoolResponse>(`${API_BASE_URL}/draft/pool`, {
    params: {
      era: eraId,
      franchise_id: franchiseId,
      exclude: excludeIds.join(","),
    },
  })
  return response.data
}

export async function postScore(
  players: DraftLineupPayloadPlayer[]
): Promise<DraftScore> {
  const response = await axios.post<DraftScore>(`${API_BASE_URL}/draft/score`, {
    players,
  })
  return response.data
}

/** Headshot proxied through our API so html2canvas can read it (ADR-004). */
export function headshotUrl(playerId: number): string {
  return `${API_BASE_URL}/headshot/${playerId}`
}
