import { useCallback, useState } from "react"
import axios from "axios"
import { API_BASE_URL } from "@/lib/config"

export interface ShotZone {
  zone_label: string
  zone_area: string
  attempts: number
  made: number
  fg_pct: number
}

export interface ShotChartData {
  available: boolean
  zones: ShotZone[]
  data_warnings: string[]
}

// Lazy shot chart fetch (ADR-002): the request is issued only when `fetch` is
// invoked — typically when ShotChartSheet opens — never on mount, so the
// comparison panel never triggers nba_api calls for charts the user may never
// open. Repeat opens for the same player-season are served from the API's TTL
// cache shared with ShotChartService.
export function useShotChart(playerId: number | null, seasonId: string | null) {
  const [data, setData] = useState<ShotChartData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    if (playerId === null || !seasonId) {
      return null
    }

    setLoading(true)
    setError(null)
    try {
      const response = await axios.get<ShotChartData>(
        `${API_BASE_URL}/shotchart/${playerId}/${encodeURIComponent(seasonId)}`
      )
      setData(response.data)
      return response.data
    } catch (caught) {
      setData(null)
      setError(getShotChartError(caught))
      return null
    } finally {
      setLoading(false)
    }
  }, [playerId, seasonId])

  const reset = useCallback(() => {
    setData(null)
    setError(null)
  }, [])

  return { data, loading, error, fetch, reset }
}

function getShotChartError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail
    if (typeof detail === "string") {
      return detail
    }
    if (!error.response) {
      return "Backend is unavailable."
    }
  }
  return "Failed to load shot chart."
}
