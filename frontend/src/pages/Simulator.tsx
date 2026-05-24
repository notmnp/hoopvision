import {
  CSSProperties,
  FormEvent,
  ReactNode,
  useEffect,
  useRef,
  useState,
} from "react"
import axios from "axios"
import { API_BASE_URL } from "@/lib/config"
import {
  AlertTriangle,
  CalendarDays,
  FastForward,
  Loader2,
  Percent,
  Repeat,
  RotateCcw,
  Search,
  Shuffle,
  Swords,
  Trophy,
  UserRound,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  PlayerProfile,
  usePlayerSearch,
} from "@/hooks/usePlayerSearch"
import {
  PlayerSeasonStats,
  usePlayerSeasons,
  usePlayerSeasonStats,
} from "@/hooks/usePlayerSeasons"

type SlotLabel = "Player A" | "Player B"

type PossessionMode = "make_it_take_it" | "alternating"

const POSSESSION_MODES: {
  value: PossessionMode
  label: string
  icon: typeof Repeat
}[] = [
  { value: "make_it_take_it", label: "Make it, take it", icon: Repeat },
  { value: "alternating", label: "Alternating", icon: Shuffle },
]

// One revealed possession per tick while the play-by-play log animates in.
const PLAY_BY_PLAY_TICK_MS = 120

type ConfidenceTier = "HIGH" | "MEDIUM" | "LOW"

const CONFIDENCE_TOOLTIPS: Record<ConfidenceTier, string> = {
  HIGH: "HIGH confidence: sufficient matchup tracking data available for this player.",
  MEDIUM:
    "MEDIUM confidence: post-tracking era player with limited observed data.",
  LOW: "LOW confidence: pre-tracking era or statistical outlier — model-generalized profile.",
}

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

interface BulkSimulationResult {
  player_a_wins: number
  player_b_wins: number
  ties: number
  total_simulations: number
  player_a_win_pct: number
  player_b_win_pct: number
}

const BULK_SIM_COUNT = 1000

interface PlayerSlotProps {
  label: SlotLabel
  selectedPlayer: PlayerProfile | null
  selectedSeason: string | null
  onSelect: (player: PlayerProfile) => void
  onClear: () => void
  onSeasonSelect: (seasonId: string | null) => void
  winPct?: number | null
  confidenceTier?: ConfidenceTier | null
}

function PlayerSelectionController() {
  const [playerA, setPlayerA] = useState<PlayerProfile | null>(null)
  const [playerB, setPlayerB] = useState<PlayerProfile | null>(null)
  const [seasonA, setSeasonA] = useState<string | null>(null)
  const [seasonB, setSeasonB] = useState<string | null>(null)
  const [possessionMode, setPossessionMode] =
    useState<PossessionMode>("make_it_take_it")
  const [simulationResult, setSimulationResult] =
    useState<SimulationResult | null>(null)
  const [simulationLoading, setSimulationLoading] = useState(false)
  const [simulationError, setSimulationError] = useState<string | null>(null)
  const [bulkResult, setBulkResult] = useState<BulkSimulationResult | null>(null)
  const [bulkLoading, setBulkLoading] = useState(false)
  // A matchup is only runnable once both players are confirmed AND each has a
  // season selected (AC-ISO-001.6 / AC-ISO-006.1).
  const canRunSimulation = Boolean(playerA && playerB && seasonA && seasonB)
  const busy = simulationLoading || bulkLoading

  function selectPlayerA(player: PlayerProfile | null) {
    setPlayerA(player)
    setSeasonA(null)
    setBulkResult(null)
    setSimulationResult(null)
  }

  function selectPlayerB(player: PlayerProfile | null) {
    setPlayerB(player)
    setSeasonB(null)
    setBulkResult(null)
    setSimulationResult(null)
  }

  function selectSeasonA(seasonId: string | null) {
    setSeasonA(seasonId)
    setBulkResult(null)
    setSimulationResult(null)
  }

  function selectSeasonB(seasonId: string | null) {
    setSeasonB(seasonId)
    setBulkResult(null)
    setSimulationResult(null)
  }

  async function runSimulation() {
    if (!playerA || !playerB || !seasonA || !seasonB) {
      return
    }

    setSimulationLoading(true)
    setSimulationError(null)

    try {
      const response = await axios.post<SimulationResult>(
        `${API_BASE_URL}/simulate`,
        {
          player_a_id: playerA.player_id,
          player_b_id: playerB.player_id,
          season_a_id: seasonA,
          season_b_id: seasonB,
          possession_mode: possessionMode,
        }
      )
      setSimulationResult(response.data)
    } catch (error) {
      setSimulationError(getSimulationError(error))
    } finally {
      setSimulationLoading(false)
    }
  }

  async function runBulkSimulation() {
    if (!playerA || !playerB || !seasonA || !seasonB) {
      return
    }

    setBulkLoading(true)
    setSimulationError(null)

    try {
      const response = await axios.post<BulkSimulationResult>(
        `${API_BASE_URL}/simulate/bulk`,
        {
          player_a_id: playerA.player_id,
          player_b_id: playerB.player_id,
          season_a_id: seasonA,
          season_b_id: seasonB,
          possession_mode: possessionMode,
          n: BULK_SIM_COUNT,
        }
      )
      setBulkResult(response.data)
    } catch (error) {
      // Fall back to looping the single-simulation endpoint client-side when
      // the bulk endpoint is unavailable (e.g. an older backend without WO-20).
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        try {
          setBulkResult(
            await runBulkClientSide(
              playerA.player_id,
              playerB.player_id,
              seasonA,
              seasonB,
              possessionMode
            )
          )
        } catch (fallbackError) {
          setSimulationError(getSimulationError(fallbackError))
        }
      } else {
        setSimulationError(getSimulationError(error))
      }
    } finally {
      setBulkLoading(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-screen-xl flex-col px-4 py-8 md:px-6">
      <div className="mb-6 flex flex-col gap-4 border-b pb-6 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Swords className="h-4 w-4" />
            ISO Simulator
          </div>
          <h1 className="text-3xl font-bold tracking-tight">
            Stage a 1v1 matchup
          </h1>
          <p className="text-sm text-muted-foreground">
            Pick two players from any era and simulate a one-on-one game to 21.
          </p>
        </div>
        <div className="flex flex-col items-stretch gap-3 sm:items-end">
          <PossessionModeToggle
            value={possessionMode}
            onChange={setPossessionMode}
            disabled={busy}
          />
          <div className="flex flex-col items-stretch gap-2 sm:flex-row md:items-end">
            <Button
              disabled={!canRunSimulation || busy}
              className="sm:w-auto"
              onClick={runSimulation}
            >
              {simulationLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Swords className="h-4 w-4" />
              )}
              {simulationResult ? "Re-run game" : "Run game"}
            </Button>
            <Button
              variant="secondary"
              disabled={!canRunSimulation || busy}
              className="sm:w-auto"
              onClick={runBulkSimulation}
            >
              {bulkLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Percent className="h-4 w-4" />
              )}
              {bulkLoading ? "Running 1,000…" : "Run 1,000 sims"}
            </Button>
          </div>
        </div>
      </div>

      {!canRunSimulation && (
        <p className="mb-4 text-sm text-muted-foreground">
          Select both players and a season for each to enable the simulation.
        </p>
      )}

      <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-[1fr_auto_1fr] lg:items-start">
        <PlayerSlot
          label="Player A"
          selectedPlayer={playerA}
          selectedSeason={seasonA}
          onSelect={selectPlayerA}
          onClear={() => selectPlayerA(null)}
          onSeasonSelect={selectSeasonA}
          winPct={bulkResult ? bulkResult.player_a_win_pct : null}
          confidenceTier={
            playerA
              ? simulationResult?.summary.player_stats[playerA.name]
                  ?.confidence_tier ?? null
              : null
          }
        />
        <div className="hidden h-full items-center justify-center lg:flex">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border bg-muted text-sm font-semibold text-muted-foreground">
            VS
          </div>
        </div>
        <PlayerSlot
          label="Player B"
          selectedPlayer={playerB}
          selectedSeason={seasonB}
          onSelect={selectPlayerB}
          onClear={() => selectPlayerB(null)}
          onSeasonSelect={selectSeasonB}
          winPct={bulkResult ? bulkResult.player_b_win_pct : null}
          confidenceTier={
            playerB
              ? simulationResult?.summary.player_stats[playerB.name]
                  ?.confidence_tier ?? null
              : null
          }
        />
      </div>

      {simulationError && (
        <Alert variant="destructive" className="mt-5">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Simulation failed</AlertTitle>
          <AlertDescription>{simulationError}</AlertDescription>
        </Alert>
      )}

      {bulkResult && playerA && playerB && (
        <WinProbabilityCard
          playerA={playerA}
          playerB={playerB}
          result={bulkResult}
        />
      )}

      {simulationResult && playerA && playerB && (
        <div className="mt-6 grid gap-4 xl:grid-cols-[24rem_1fr]">
          <MatchSummaryView
            summary={simulationResult.summary}
            playerA={playerA}
            playerB={playerB}
            onRerun={runSimulation}
            rerunDisabled={busy}
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
  selectedSeason,
  onSelect,
  onClear,
  onSeasonSelect,
  winPct,
  confidenceTier,
}: PlayerSlotProps) {
  const [query, setQuery] = useState("")
  const { player, loading, error, searchPlayer, clearPlayer } = usePlayerSearch()
  const {
    seasons,
    loading: seasonsLoading,
    error: seasonsError,
    loadSeasons,
    clearSeasons,
  } = usePlayerSeasons()
  const {
    stats: seasonStats,
    loading: seasonStatsLoading,
    error: seasonStatsError,
    loadSeasonStats,
    clearSeasonStats,
  } = usePlayerSeasonStats()

  const profile = selectedPlayer ?? player

  // Confirm a freshly searched player: reset any prior season selection and
  // load the seasons available for the new player.
  function confirmPlayer(result: PlayerProfile) {
    onSelect(result)
    onSeasonSelect(null)
    clearSeasonStats()
    loadSeasons(result.player_id)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const result = await searchPlayer(query)
    if (result) {
      confirmPlayer(result)
    }
  }

  function handleClear() {
    clearPlayer()
    clearSeasons()
    clearSeasonStats()
    setQuery("")
    onClear()
    onSeasonSelect(null)
  }

  function handleSeasonChange(seasonId: string) {
    if (!seasonId) {
      onSeasonSelect(null)
      clearSeasonStats()
      return
    }
    onSeasonSelect(seasonId)
    if (profile) {
      loadSeasonStats(profile.player_id, seasonId)
    }
  }

  return (
    <Card className="min-h-[32rem] rounded-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <UserRound className="h-4 w-4" />
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search a player…"
            aria-label={`Search ${label}`}
          />
          <Button
            type="submit"
            size="icon"
            aria-label={`Search ${label}`}
            disabled={loading || !query.trim()}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
          </Button>
        </form>

        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {profile ? (
          <div className="space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <PlayerAvatar
                  playerId={profile.player_id}
                  name={profile.name}
                />
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-2xl font-semibold leading-tight">
                      {profile.name}
                    </h2>
                    {confidenceTier && <ConfidenceBadge tier={confidenceTier} />}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {profile.position && <Badge>{profile.position}</Badge>}
                    {profile.team && (
                      <Badge variant="secondary">{profile.team}</Badge>
                    )}
                    {winPct != null && (
                      <Pill tone="brand">Wins {Math.round(winPct)}%</Pill>
                    )}
                  </div>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={handleClear}>
                Clear
              </Button>
            </div>

            <SeasonSelector
              label={label}
              seasons={seasons}
              value={selectedSeason}
              loading={seasonsLoading}
              onChange={handleSeasonChange}
            />

            {seasonsError && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{seasonsError}</AlertDescription>
              </Alert>
            )}

            <Separator />

            <div className="grid grid-cols-2 gap-3">
              <Attribute label="Height" value={profile.height ?? "N/A"} />
              <Attribute label="Weight" value={formatWeight(profile.weight)} />
              <Attribute
                label="Wingspan"
                value={formatWingspan(profile.wingspan)}
              />
              <Attribute
                label="Season"
                value={selectedSeason ?? "Not selected"}
              />
            </div>

            <SeasonStatsPanel
              selectedSeason={selectedSeason}
              stats={seasonStats}
              loading={seasonStatsLoading}
              error={seasonStatsError}
            />

            {profile.data_warnings.length > 0 && (
              <WarningAlert warnings={profile.data_warnings} />
            )}
          </div>
        ) : (
          <div className="flex min-h-72 flex-col items-center justify-center gap-2 rounded-md border border-dashed text-sm text-muted-foreground">
            <UserRound className="h-8 w-8 opacity-40" />
            No player selected
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function SeasonSelector({
  label,
  seasons,
  value,
  loading,
  onChange,
}: {
  label: SlotLabel
  seasons: { season_id: string; season_label: string }[]
  value: string | null
  loading: boolean
  onChange: (seasonId: string) => void
}) {
  return (
    <div className="space-y-1.5">
      <label
        className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground"
        htmlFor={`${label}-season`}
      >
        <CalendarDays className="h-3.5 w-3.5" />
        Season
      </label>
      <div className="relative">
        <select
          id={`${label}-season`}
          aria-label={`Select season for ${label}`}
          value={value ?? ""}
          disabled={loading || seasons.length === 0}
          onChange={(event) => onChange(event.target.value)}
          className={cn(
            "flex h-9 w-full appearance-none rounded-md border border-input bg-background px-3 py-1 pr-8 text-sm shadow-sm transition-colors",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            "disabled:cursor-not-allowed disabled:opacity-50"
          )}
        >
          <option value="" disabled>
            {loading ? "Loading seasons…" : "Select a season"}
          </option>
          {seasons.map((season) => (
            <option key={season.season_id} value={season.season_id}>
              {season.season_label}
            </option>
          ))}
        </select>
        {loading ? (
          <Loader2 className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : (
          <CalendarDays className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        )}
      </div>
    </div>
  )
}

function SeasonStatsPanel({
  selectedSeason,
  stats,
  loading,
  error,
}: {
  selectedSeason: string | null
  stats: PlayerSeasonStats | null
  loading: boolean
  error: string | null
}) {
  if (!selectedSeason) {
    return (
      <div className="flex items-center justify-center rounded-md border border-dashed p-4 text-sm text-muted-foreground">
        Select a season to view that year's stats.
      </div>
    )
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  }

  if (loading || !stats) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading {selectedSeason} stats…
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {stats.season_label} per game
      </div>
      <div className="grid grid-cols-3 gap-3 rounded-md border bg-muted/30 p-3">
        <Stat label="PTS" value={stats.points_per_game} />
        <Stat label="REB" value={stats.rebound_per_game} />
        <Stat label="AST" value={stats.assist_per_game} />
        <Stat label="FGA" value={stats.fga_per_game} />
        <Stat label="BLK" value={stats.block_per_game} />
        <Stat label="STL" value={stats.steal_per_game} />
      </div>
    </div>
  )
}

function PlayerAvatar({
  playerId,
  name,
}: {
  playerId: number
  name: string
}) {
  return (
    <Avatar className="h-14 w-14 rounded-md border bg-muted">
      <AvatarImage
        src={`https://cdn.nba.com/headshots/nba/latest/1040x760/${playerId}.png`}
        alt={name}
        className="object-cover object-top"
      />
      <AvatarFallback className="rounded-md text-sm font-semibold">
        {getInitials(name)}
      </AvatarFallback>
    </Avatar>
  )
}

type PillTone = "brand" | "success" | "warning" | "danger" | "neutral"

const PILL_TONES: Record<PillTone, string> = {
  brand: "border-primary/20 bg-primary/10 text-primary",
  success:
    "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  warning:
    "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  danger: "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-400",
  neutral: "border-border bg-muted text-muted-foreground",
}

function Pill({
  tone = "neutral",
  dot = false,
  className,
  children,
}: {
  tone?: PillTone
  dot?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <Badge
      variant="outline"
      className={cn("gap-1.5 font-medium", PILL_TONES[tone], className)}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </Badge>
  )
}

function ConfidenceBadge({ tier }: { tier: ConfidenceTier }) {
  const tone: PillTone =
    tier === "HIGH" ? "success" : tier === "MEDIUM" ? "warning" : "danger"
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="cursor-default">
          <Pill tone={tone} dot>
            {titleCase(tier)} confidence
          </Pill>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        {CONFIDENCE_TOOLTIPS[tier]}
      </TooltipContent>
    </Tooltip>
  )
}

function PossessionModeToggle({
  value,
  onChange,
  disabled,
}: {
  value: PossessionMode
  onChange: (mode: PossessionMode) => void
  disabled?: boolean
}) {
  return (
    <div className="flex flex-col gap-1.5 sm:items-end">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Possession mode
      </span>
      <div
        role="radiogroup"
        aria-label="Possession mode"
        className="inline-flex rounded-md border bg-muted/40 p-0.5"
      >
        {POSSESSION_MODES.map((mode) => {
          const Icon = mode.icon
          const active = value === mode.value
          return (
            <button
              key={mode.value}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => onChange(mode.value)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-[5px] px-3 py-1.5 text-sm font-medium transition-colors",
                "disabled:cursor-not-allowed disabled:opacity-50",
                active
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {mode.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function WinProbabilityCard({
  playerA,
  playerB,
  result,
}: {
  playerA: PlayerProfile
  playerB: PlayerProfile
  result: BulkSimulationResult
}) {
  return (
    <Card className="mt-6 rounded-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Percent className="h-4 w-4" />
          Win probability · {result.total_simulations.toLocaleString()} simulations
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between text-sm font-medium">
          <span className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-primary" />
            {playerA.name}
          </span>
          <span className="flex items-center gap-2">
            {playerB.name}
            <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/40" />
          </span>
        </div>
        <Progress value={result.player_a_win_pct} className="h-3" />
        <div className="flex items-center justify-between text-2xl font-bold">
          <span>{Math.round(result.player_a_win_pct)}%</span>
          <span className="text-muted-foreground">
            {Math.round(result.player_b_win_pct)}%
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          {playerA.name} won {result.player_a_wins.toLocaleString()},{" "}
          {playerB.name} won {result.player_b_wins.toLocaleString()}
          {result.ties > 0 && `, ${result.ties.toLocaleString()} ties`}.
        </p>
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
    <div className="text-center">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold">
        {typeof value === "number" ? value.toFixed(1) : "N/A"}
      </div>
    </div>
  )
}

function WarningAlert({ warnings }: { warnings: string[] }) {
  return (
    <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 [&>svg]:text-amber-600 dark:[&>svg]:text-amber-400">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>Data limitations</AlertTitle>
      <AlertDescription className="text-amber-700/90 dark:text-amber-300/90">
        <ul className="list-disc space-y-1 pl-4">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
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
  const aWon = summary.final_score.a >= summary.final_score.b
  return (
    <Card className="rounded-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Trophy className="h-4 w-4" />
          Match summary
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <div className="text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Final
          </div>
          <div className="divide-y overflow-hidden rounded-md border">
            <ScoreRow
              name={playerA.name}
              score={summary.final_score.a}
              winner={aWon}
            />
            <ScoreRow
              name={playerB.name}
              score={summary.final_score.b}
              winner={!aWon}
            />
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
          <WarningAlert warnings={summary.data_warnings} />
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

function ScoreRow({
  name,
  score,
  winner,
}: {
  name: string
  score: number
  winner: boolean
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 px-4 py-3",
        winner ? "bg-emerald-500/5" : "bg-muted/20"
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate font-semibold">{name}</span>
        {winner && (
          <Pill tone="success">
            <Trophy className="h-3 w-3" />
            Winner
          </Pill>
        )}
      </div>
      <span
        className={cn(
          "text-3xl font-bold tabular-nums",
          !winner && "text-muted-foreground"
        )}
      >
        {score}
      </span>
    </div>
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
    <div className="space-y-4 rounded-md border p-4">
      <div className="font-semibold">{playerName}</div>

      <div className="grid grid-cols-3 gap-2">
        <StatTile label="PTS" value={String(stats.points)} />
        <StatTile label="FG%" value={formatPct(stats.shooting_percentage)} />
        <StatTile label="3PT%" value={formatPct(stats.three_point_percentage)} />
      </div>

      <ShotMap
        attempts={stats.shot_type_distribution}
        percentages={
          stats.shot_type_percentage ?? { rim: 0, mid_range: 0, three: 0 }
        }
      />

      <div className="flex items-center gap-4 border-t pt-3 text-xs text-muted-foreground">
        <span>
          Turnovers{" "}
          <span className="font-medium tabular-nums text-foreground">
            {stats.turnovers}
          </span>
        </span>
        <span>
          Fouls drawn{" "}
          <span className="font-medium tabular-nums text-foreground">
            {stats.fouls_drawn}
          </span>
        </span>
      </div>
    </div>
  )
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/30 p-2 text-center">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  )
}

type ShotCounts = { rim: number; mid_range: number; three: number }

// Per-zone shooting-efficiency grading. Thresholds are zone-specific because a
// good three (~37%) and a good rim finish (~60%) sit at very different rates.
const ZONE_THRESHOLDS: Record<keyof ShotCounts, { ok: number; good: number }> = {
  rim: { ok: 0.45, good: 0.6 },
  mid_range: { ok: 0.33, good: 0.42 },
  three: { ok: 0.3, good: 0.37 },
}

const ZONE_COLORS = {
  good: { fill: "rgba(16,185,129,0.30)", stroke: "rgba(16,185,129,0.55)" },
  ok: { fill: "rgba(234,179,8,0.32)", stroke: "rgba(234,179,8,0.60)" },
  poor: { fill: "rgba(239,68,68,0.28)", stroke: "rgba(239,68,68,0.55)" },
  none: { fill: "rgba(148,163,184,0.14)", stroke: "rgba(148,163,184,0.40)" },
}

function gradeZone(zone: keyof ShotCounts, pct: number, attempts: number) {
  if (attempts === 0) return ZONE_COLORS.none
  const { ok, good } = ZONE_THRESHOLDS[zone]
  if (pct >= good) return ZONE_COLORS.good
  if (pct >= ok) return ZONE_COLORS.ok
  return ZONE_COLORS.poor
}

// Stylized half-court: zones radiate up from the basket (rim → mid-range →
// three), each colored by how efficiently the player shot from it.
function ShotMap({
  attempts,
  percentages,
}: {
  attempts: ShotCounts
  percentages: ShotCounts
}) {
  const total = attempts.rim + attempts.mid_range + attempts.three
  // Court geometry (viewBox 200 x 150); zones are semicircles from the hoop.
  const cx = 100
  const cy = 132
  const rRim = 30
  const rMid = 62
  const rThree = 95

  const semi = (r: number) =>
    `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy} Z`
  const ring = (ri: number, ro: number) =>
    `M ${cx - ro} ${cy} A ${ro} ${ro} 0 0 1 ${cx + ro} ${cy} ` +
    `L ${cx + ri} ${cy} A ${ri} ${ri} 0 0 0 ${cx - ri} ${cy} Z`

  const zones = [
    { key: "three" as const, path: ring(rMid, rThree), top: "19%" },
    { key: "mid_range" as const, path: ring(rRim, rMid), top: "48%" },
    { key: "rim" as const, path: semi(rRim), top: "76%" },
  ]
  const labels: Record<keyof ShotCounts, string> = {
    rim: "Rim",
    mid_range: "Mid",
    three: "3PT",
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Shot map
        </span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {total} FGA
        </span>
      </div>

      <div className="relative mx-auto aspect-[20/11] w-full max-w-[300px]">
        <svg
          viewBox="0 33 200 110"
          className="absolute inset-0 h-full w-full"
          preserveAspectRatio="xMidYMid meet"
        >
          {zones.map((zone) => {
            const color = gradeZone(
              zone.key,
              percentages[zone.key],
              attempts[zone.key]
            )
            return (
              <path
                key={zone.key}
                d={zone.path}
                fill={color.fill}
                stroke={color.stroke}
                strokeWidth={1}
              />
            )
          })}
          {/* hoop: rim circle above the backboard */}
          <circle
            cx={cx}
            cy={cy - 3}
            r={6}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className="text-foreground/70"
          />
          <rect
            x={cx - 15}
            y={cy + 4}
            width={30}
            height={3}
            rx={1.5}
            className="fill-foreground/70"
          />
        </svg>

        {zones.map((zone) => (
          <ZoneChip
            key={zone.key}
            style={{ top: zone.top }}
            label={labels[zone.key]}
            attempts={attempts[zone.key]}
            pct={percentages[zone.key]}
          />
        ))}
      </div>
    </div>
  )
}

function ZoneChip({
  label,
  attempts,
  pct,
  style,
}: {
  label: string
  attempts: number
  pct: number
  style?: CSSProperties
}) {
  return (
    <span
      style={style}
      className="absolute left-1/2 flex -translate-x-1/2 -translate-y-1/2 items-baseline gap-1 rounded-md bg-background/85 px-1.5 py-0.5 text-[11px] font-medium shadow-sm ring-1 ring-border"
    >
      <span>{label}</span>
      <span className="tabular-nums">
        {attempts ? `${Math.round(pct * 100)}%` : "—"}
      </span>
      <span className="tabular-nums text-muted-foreground">({attempts})</span>
    </span>
  )
}

function PlayByPlayView({ playByPlay }: { playByPlay: PlayByPlay[] }) {
  // Reveal possessions one at a time. A new result (new array reference) resets
  // the reveal so each simulation animates from the beginning (AC-ISO-003.4).
  const [visibleCount, setVisibleCount] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  function stopInterval() {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }

  useEffect(() => {
    setVisibleCount(0)
    stopInterval()

    if (playByPlay.length === 0) {
      return
    }

    intervalRef.current = setInterval(() => {
      setVisibleCount((count) => {
        const next = count + 1
        if (next >= playByPlay.length) {
          stopInterval()
        }
        return Math.min(next, playByPlay.length)
      })
    }, PLAY_BY_PLAY_TICK_MS)

    return stopInterval
  }, [playByPlay])

  function skipAnimation() {
    stopInterval()
    setVisibleCount(playByPlay.length)
  }

  const animating = visibleCount < playByPlay.length
  const visiblePlays = playByPlay.slice(0, visibleCount)

  return (
    <Card className="flex flex-col rounded-lg">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Play-by-play
        </CardTitle>
        {animating && (
          <Button variant="ghost" size="sm" onClick={skipAnimation}>
            <FastForward className="h-4 w-4" />
            Skip animation
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-[20rem] flex-1 space-y-2 overflow-y-auto pr-1 xl:min-h-0">
          {visiblePlays.map((play) => (
            <div
              key={play.possession}
              className="grid grid-cols-[2.5rem_1fr_auto] items-center gap-3 rounded-md border p-3 text-sm"
            >
              <div className="text-xs font-medium tabular-nums text-muted-foreground">
                #{play.possession}
              </div>
              <div className="min-w-0">
                <div className="truncate font-medium">
                  {play.offensive_player}
                </div>
                <div className="text-xs text-muted-foreground">
                  {playDetail(play)}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <OutcomeBadge play={play} />
                <span className="w-12 text-right font-semibold tabular-nums">
                  {play.score_a}-{play.score_b}
                </span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function OutcomeBadge({ play }: { play: PlayByPlay }) {
  if (play.turnover) {
    return (
      <Pill tone="danger" dot>
        Turnover
      </Pill>
    )
  }
  if (play.foul) {
    return (
      <Pill tone="warning" dot>
        Foul
      </Pill>
    )
  }
  if (play.result === "made") {
    return (
      <Pill tone="success" dot>
        Made
      </Pill>
    )
  }
  return (
    <Pill tone="neutral" dot>
      Missed
    </Pill>
  )
}

function playDetail(play: PlayByPlay): string {
  if (play.turnover) {
    return "Lost possession"
  }
  if (play.foul) {
    return "Drew a foul — possession retained"
  }
  const type = formatShotType(play.shot_type)
  return type.charAt(0).toUpperCase() + type.slice(1)
}

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
}

function formatWeight(weight: string | null) {
  return weight ? `${weight} lb` : "N/A"
}

function formatWingspan(wingspan: number | null) {
  return typeof wingspan === "number" ? `${wingspan.toFixed(1)} in` : "N/A"
}

function formatPct(value: number) {
  return `${(value * 100).toFixed(1)}%`
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase()
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

const SimulatorView = PlayerSelectionController

export default SimulatorView

async function runBulkClientSide(
  playerAId: number,
  playerBId: number,
  seasonAId: string,
  seasonBId: string,
  possessionMode: PossessionMode
): Promise<BulkSimulationResult> {
  let playerAWins = 0
  let playerBWins = 0
  let ties = 0

  for (let seed = 0; seed < BULK_SIM_COUNT; seed++) {
    const response = await axios.post<SimulationResult>(
      `${API_BASE_URL}/simulate`,
      {
        player_a_id: playerAId,
        player_b_id: playerBId,
        season_a_id: seasonAId,
        season_b_id: seasonBId,
        possession_mode: possessionMode,
        seed,
      }
    )
    const { a, b } = response.data.summary.final_score
    if (a > b) {
      playerAWins++
    } else if (b > a) {
      playerBWins++
    } else {
      ties++
    }
  }

  return {
    player_a_wins: playerAWins,
    player_b_wins: playerBWins,
    ties,
    total_simulations: BULK_SIM_COUNT,
    player_a_win_pct: Math.round((10000 * playerAWins) / BULK_SIM_COUNT) / 100,
    player_b_win_pct: Math.round((10000 * playerBWins) / BULK_SIM_COUNT) / 100,
  }
}

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
