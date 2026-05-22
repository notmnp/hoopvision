import { useState } from "react"
import axios from "axios"

export interface PlayerProfile {
  player_id: number
  name: string
  height: string | null
  weight: string | null
  wingspan: number | null
  position: string | null
  team: string | null
  from_year: string | number | null
  to_year: string | number | null
  draft_year: string | number | null
  data_warnings: string[]
  headline_stats: {
    points: number | null
    assists: number | null
    rebounds: number | null
    pie: number | null
  }
}

interface PlayerSearchResponse {
  player: string
  data: PlayerProfile
}

export function usePlayerSearch() {
  const [player, setPlayer] = useState<PlayerProfile | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function searchPlayer(name: string) {
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError("Enter a player name.")
      setPlayer(null)
      return null
    }

    setLoading(true)
    setError(null)

    try {
      const response = await axios.get<PlayerSearchResponse>(
        `http://localhost:8000/player/${encodeURIComponent(trimmedName)}`
      )
      setPlayer(response.data.data)
      return response.data.data
    } catch {
      setPlayer(null)
      setError("Player not found.")
      return null
    } finally {
      setLoading(false)
    }
  }

  function clearPlayer() {
    setPlayer(null)
    setError(null)
  }

  return {
    player,
    loading,
    error,
    searchPlayer,
    clearPlayer,
  }
}
