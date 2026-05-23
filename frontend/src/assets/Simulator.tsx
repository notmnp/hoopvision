import { FormEvent, useState } from "react"
import axios from "axios"
import {
  AlertTriangle,
  Loader2,
  RotateCcw,
  Search,
  Swords,
  Trophy,
  UserRound,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  PlayerProfile,
  usePlayerSearch,
} from "@/hooks/usePlayerSearch"

type SlotLabel = "Player A" | "Player B"

interface PlayByPlay {
  possession: number
  offensive_player: string
  shot_type: string
  result: string
  foul: boolean
  turnover: boolean
  score_a: number
  score_b: number
}

interface PlayerSimStats {
  points: number
  shooting_percentage: number
  shot_type_distribution: {
    rim: number
    mid_range: number
    three: number
  }
  turnovers: number
  fouls_drawn: number
}

interface MatchSummary {
  winner: string
  final_score: {
    a: number
    b: number
  }
  player_stats: Record<string, PlayerSimStats>
  data_warnings: string[]
}

interface SimulationResult {
  play_by_play: PlayByPlay[]
  summary: MatchSummary
}

interface PlayerSlotProps {
  label: SlotLabel
  selectedPlayer: PlayerProfile | null
  onSelect: (player: PlayerProfile) => void
  onClear: () => void
}

function PlayerSelectionController() {
  const [playerA, setPlayerA] = useState<PlayerProfile | null>(null)
  const [playerB, setPlayerB] = useState<PlayerProfile | null>(null)
  const [simulationResult, setSimulationResult] =
    useState<SimulationResult | null>(null)
  const [simulationLoading, setSimulationLoading] = useState(false)
  const [simulationError, setSimulationError] = useState<string | null>(null)
  const canRunSimulation = Boolean(playerA && playerB)

  async function runSimulation() {
    if (!playerA || !playerB) {
      return
    }

    setSimulationLoading(true)
    setSimulationError(null)

    try {
      const response = await axios.post<SimulationResult>(
        "http://localhost:8000/simulate",
        {
          player_a_id: playerA.player_id,
          player_b_id: playerB.player_id,
        }
      )
      setSimulationResult(response.data)
    } catch (error) {
      setSimulationError(getSimulationError(error))
    } finally {
      setSimulationLoading(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-screen-xl flex-col px-4 py-6 md:px-6">
      <div className="mb-6 flex flex-col gap-3 border-b pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">ISO Simulator</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Select two players to stage a 1v1 matchup.
          </p>
        </div>
        <Button
          disabled={!canRunSimulation || simulationLoading}
          className="w-full md:w-auto"
          onClick={runSimulation}
        >
          {simulationLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Swords className="h-4 w-4" />
          )}
          {simulationResult ? "Re-run" : "Run Simulation"}
        </Button>
      </div>

      <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-[1fr_auto_1fr] lg:items-start">
        <PlayerSlot
          label="Player A"
          selectedPlayer={playerA}
          onSelect={setPlayerA}
          onClear={() => setPlayerA(null)}
        />
        <div className="hidden h-full items-center justify-center lg:flex">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border bg-muted text-sm font-semibold">
            VS
          </div>
        </div>
        <PlayerSlot
          label="Player B"
          selectedPlayer={playerB}
          onSelect={setPlayerB}
          onClear={() => setPlayerB(null)}
        />
      </div>

      {simulationError && (
        <div className="mt-5 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {simulationError}
        </div>
      )}

      {simulationResult && playerA && playerB && (
        <div className="mt-6 grid gap-4 xl:grid-cols-[24rem_1fr]">
          <MatchSummaryView
            summary={simulationResult.summary}
            playerA={playerA}
            playerB={playerB}
            onRerun={runSimulation}
            rerunDisabled={simulationLoading}
          />
          <PlayByPlayView playByPlay={simulationResult.play_by_play} />
        </div>
      )}
    </div>
  )
}

function PlayerSlot({
  label,
  selectedPlayer,
  onSelect,
  onClear,
}: PlayerSlotProps) {
  const [query, setQuery] = useState("")
  const { player, loading, error, searchPlayer, clearPlayer } = usePlayerSearch()

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const result = await searchPlayer(query)
    if (result) {
      onSelect(result)
    }
  }

  function handleClear() {
    clearPlayer()
    setQuery("")
    onClear()
  }

  const profile = selectedPlayer ?? player

  return (
    <Card className="min-h-[32rem] rounded-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <UserRound className="h-4 w-4" />
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search player"
            className="h-10 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm outline-none ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
          <Button type="submit" size="icon" disabled={loading}>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
          </Button>
        </form>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {profile ? (
          <div className="space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-2xl font-semibold leading-tight">
                  {profile.name}
                </h2>
                <div className="mt-2 flex flex-wrap gap-2">
                  {profile.position && <Badge>{profile.position}</Badge>}
                  {profile.team && <Badge variant="secondary">{profile.team}</Badge>}
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={handleClear}>
                Clear
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Attribute label="Height" value={profile.height ?? "N/A"} />
              <Attribute label="Weight" value={formatWeight(profile.weight)} />
              <Attribute
                label="Wingspan"
                value={formatWingspan(profile.wingspan)}
              />
              <Attribute
                label="Career"
                value={formatCareer(profile.from_year, profile.to_year)}
              />
            </div>

            <div className="grid grid-cols-3 gap-3 border-t pt-4">
              <Stat label="PTS" value={profile.headline_stats.points} />
              <Stat label="REB" value={profile.headline_stats.rebounds} />
              <Stat label="AST" value={profile.headline_stats.assists} />
            </div>

            {profile.data_warnings.length > 0 && (
              <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="space-y-1">
                  {profile.data_warnings.map((warning) => (
                    <p key={warning}>{warning}</p>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex min-h-72 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
            No player selected
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function Attribute({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-semibold">{value}</div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold">
        {typeof value === "number" ? value.toFixed(1) : "N/A"}
      </div>
    </div>
  )
}

function MatchSummaryView({
  summary,
  playerA,
  playerB,
  onRerun,
  rerunDisabled,
}: {
  summary: MatchSummary
  playerA: PlayerProfile
  playerB: PlayerProfile
  onRerun: () => void
  rerunDisabled: boolean
}) {
  return (
    <Card className="rounded-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Trophy className="h-4 w-4" />
          Match Summary
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="rounded-md border bg-muted/30 p-4">
          <div className="text-sm text-muted-foreground">Winner</div>
          <div className="mt-1 text-2xl font-bold">{summary.winner}</div>
          <div className="mt-3 flex items-center gap-3 text-sm">
            <span>{playerA.name}</span>
            <span className="text-xl font-semibold">
              {summary.final_score.a}-{summary.final_score.b}
            </span>
            <span>{playerB.name}</span>
          </div>
        </div>

        <div className="space-y-3">
          {Object.entries(summary.player_stats).map(([playerName, stats]) => (
            <PlayerStatsSummary
              key={playerName}
              playerName={playerName}
              stats={stats}
            />
          ))}
        </div>

        {summary.data_warnings.length > 0 && (
          <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="space-y-1">
              {summary.data_warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          </div>
        )}

        <Button
          variant="outline"
          className="w-full"
          onClick={onRerun}
          disabled={rerunDisabled}
        >
          {rerunDisabled ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RotateCcw className="h-4 w-4" />
          )}
          Re-run
        </Button>
      </CardContent>
    </Card>
  )
}

function PlayerStatsSummary({
  playerName,
  stats,
}: {
  playerName: string
  stats: PlayerSimStats
}) {
  return (
    <div className="rounded-md border p-3">
      <div className="font-semibold">{playerName}</div>
      <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
        <Attribute label="Points" value={String(stats.points)} />
        <Attribute
          label="FG%"
          value={`${(stats.shooting_percentage * 100).toFixed(1)}%`}
        />
        <Attribute label="Turnovers" value={String(stats.turnovers)} />
        <Attribute label="Fouls Drawn" value={String(stats.fouls_drawn)} />
      </div>
      <div className="mt-3 text-xs text-muted-foreground">
        Rim {stats.shot_type_distribution.rim} | Mid{" "}
        {stats.shot_type_distribution.mid_range} | 3PT{" "}
        {stats.shot_type_distribution.three}
      </div>
    </div>
  )
}

function PlayByPlayView({ playByPlay }: { playByPlay: PlayByPlay[] }) {
  return (
    <Card className="rounded-lg">
      <CardHeader>
        <CardTitle className="text-base">Play-by-Play</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="max-h-[34rem] space-y-2 overflow-y-auto pr-1">
          {playByPlay.map((play) => (
            <div
              key={play.possession}
              className="grid gap-2 rounded-md border p-3 text-sm md:grid-cols-[4rem_1fr_auto]"
            >
              <div className="font-medium text-muted-foreground">
                #{play.possession}
              </div>
              <div>
                <div className="font-medium">{play.offensive_player}</div>
                <div className="text-muted-foreground">
                  {formatShotType(play.shot_type)} {formatResult(play.result)}
                  {play.foul && " with a foul"}
                  {play.turnover && " turnover"}
                </div>
              </div>
              <div className="font-semibold">
                {play.score_a}-{play.score_b}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function formatWeight(weight: string | null) {
  return weight ? `${weight} lb` : "N/A"
}

function formatWingspan(wingspan: number | null) {
  return typeof wingspan === "number" ? `${wingspan.toFixed(1)} in` : "N/A"
}

function formatCareer(
  fromYear: string | number | null,
  toYear: string | number | null
) {
  if (!fromYear && !toYear) {
    return "N/A"
  }
  return `${fromYear ?? "?"}-${toYear ?? "?"}`
}

function formatShotType(shotType: string) {
  if (shotType === "mid_range") {
    return "mid-range"
  }
  if (shotType === "three") {
    return "three-point"
  }
  return shotType
}

function formatResult(result: string) {
  if (result === "foul_drawn") {
    return "foul drawn"
  }
  return result
}

const SimulatorView = PlayerSelectionController

export default SimulatorView

function getSimulationError(error: unknown) {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail
    if (typeof detail === "string") {
      return detail
    }

    if (!error.response) {
      return "Backend is unavailable."
    }
  }

  return "Simulation failed. Try running the matchup again."
}
