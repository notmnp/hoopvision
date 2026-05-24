import { useCallback, useState } from "react"
import axios from "axios"
import { API_BASE_URL } from "@/lib/config"

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
    const trimmedName = decodePlayerSearchInput(name).trim()
    if (!trimmedName) {
      setError("Enter a player name.")
      setPlayer(null)
      return null
    }

    setLoading(true)
    setError(null)

    try {
      const response = await axios.get<PlayerSearchResponse>(
        `${API_BASE_URL}/player/${encodeURIComponent(trimmedName)}`
      )
      setPlayer(response.data.data)
      return response.data.data
    } catch (error) {
      setPlayer(null)
      setError(getPlayerSearchError(error))
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

export interface PlayerSuggestion {
  id: number
  full_name: string
}

export function usePlayerSuggestions() {
  const [suggestions, setSuggestions] = useState<PlayerSuggestion[]>([])
  const [loading, setLoading] = useState(false)

  // Memoized so consumers can safely list these in effect dependency arrays
  // (e.g. a debounced search effect) without re-running every render.
  const searchSuggestions = useCallback(async (query: string) => {
    const trimmedName = query.trim()
    if (!trimmedName) {
      setSuggestions([])
      return
    }

    setLoading(true)
    try {
      const response = await axios.get<PlayerSuggestion[]>(
        `${API_BASE_URL}/players/search`,
        { params: { q: trimmedName } }
      )
      setSuggestions(response.data)
    } catch {
      setSuggestions([])
    } finally {
      setLoading(false)
    }
  }, [])

  const clearSuggestions = useCallback(() => {
    setSuggestions([])
  }, [])

  return { suggestions, loading, searchSuggestions, clearSuggestions }
}

function decodePlayerSearchInput(name: string) {
  try {
    return decodeURIComponent(name)
  } catch {
    return name
  }
}

function getPlayerSearchError(error: unknown) {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail
    if (typeof detail === "string") {
      return detail
    }

    if (error.response?.status === 404) {
      return "Player not found."
    }

    if (!error.response) {
      return "Backend is unavailable."
    }
  }

  return "Player lookup failed."
}
