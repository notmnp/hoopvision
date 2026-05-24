import { useState } from "react"
import axios from "axios"
import { API_BASE_URL } from "@/lib/config"

export interface PlayerSeasonOption {
  season_id: string
  season_label: string
}

export interface PlayerSeasonStats {
  season_id: string
  season_label: string
  season_year: number
  points_per_game: number
  fga_per_game: number
  three_point_attempt_rate: number
  free_throw_attempt_rate: number
  assist_per_game: number
  turnover_per_game: number
  rebound_per_game: number
  block_per_game: number
  steal_per_game: number
}

export function usePlayerSeasons() {
  const [seasons, setSeasons] = useState<PlayerSeasonOption[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function loadSeasons(playerId: number) {
    setLoading(true)
    setError(null)
    try {
      const response = await axios.get<PlayerSeasonOption[]>(
        `${API_BASE_URL}/player/${playerId}/seasons`
      )
      setSeasons(response.data)
      return response.data
    } catch (caught) {
      setSeasons([])
      setError(getSeasonsError(caught))
      return null
    } finally {
      setLoading(false)
    }
  }

  function clearSeasons() {
    setSeasons([])
    setError(null)
  }

  return { seasons, loading, error, loadSeasons, clearSeasons }
}

export function usePlayerSeasonStats() {
  const [stats, setStats] = useState<PlayerSeasonStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function loadSeasonStats(playerId: number, seasonId: string) {
    setLoading(true)
    setError(null)
    try {
      const response = await axios.get<PlayerSeasonStats>(
        `${API_BASE_URL}/player/${playerId}/season/${encodeURIComponent(seasonId)}`
      )
      setStats(response.data)
      return response.data
    } catch (caught) {
      setStats(null)
      setError(getSeasonsError(caught))
      return null
    } finally {
      setLoading(false)
    }
  }

  function clearSeasonStats() {
    setStats(null)
    setError(null)
  }

  return { stats, loading, error, loadSeasonStats, clearSeasonStats }
}

function getSeasonsError(error: unknown) {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail
    if (typeof detail === "string") {
      return detail
    }
    if (!error.response) {
      return "Backend is unavailable."
    }
  }
  return "Failed to load season data."
}
