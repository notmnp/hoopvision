import { useEffect, useState } from "react"
import axios from "axios"
import { API_BASE_URL } from "@/lib/config"

export interface Team {
  teamId: number
  teamTricode: string
  score: number
  wins: number
  losses: number
}

export interface Leader {
  personId: number
  name: string
  points: number
}

export interface Game {
  gameId: string
  gameStatusText: string
  gameLabel: string
  homeTeam: Team
  awayTeam: Team
  gameLeaders?: {
    homeLeaders?: Leader
    awayLeaders?: Leader
  }
}

interface ScoreboardResponse {
  scoreboard: {
    games: Game[]
  }
}

export function useScoreboard() {
  const [games, setGames] = useState<Game[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function fetchScoreboard() {
      setLoading(true)
      setError(null)

      try {
        const response = await axios.get<ScoreboardResponse>(
          `${API_BASE_URL}/scoreboard`
        )
        if (!cancelled) {
          setGames(response.data.scoreboard.games)
        }
      } catch (error) {
        if (!cancelled) {
          setGames([])
          setError(getScoreboardError(error))
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    fetchScoreboard()

    return () => {
      cancelled = true
    }
  }, [])

  return {
    games,
    loading,
    error,
  }
}

function getScoreboardError(error: unknown) {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail
    if (typeof detail === "string") {
      return detail
    }

    if (!error.response) {
      return "Backend is unavailable."
    }
  }

  return "Scoreboard lookup failed."
}
