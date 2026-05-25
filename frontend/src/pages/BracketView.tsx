import { useCallback, useEffect, useRef, useState } from "react"
import { Link, useParams } from "react-router-dom"
import axios from "axios"
import {
  AlertTriangle,
  ArrowLeft,
  Crown,
  Download,
  FastForward,
  ListOrdered,
  Loader2,
  PlayCircle,
  Trophy,
} from "lucide-react"

import { API_BASE_URL } from "@/lib/config"
import {
  BracketMatchup,
  BracketParticipant,
  BracketState,
  headshotUrl,
  roundName,
} from "@/lib/bracket"
import { SimulationResult } from "@/lib/simulation"
import { exportBracketImage } from "@/lib/bracketExporter"
import { cn } from "@/lib/utils"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { MatchSummaryView, PlayByPlayView } from "@/pages/Simulator"

export default function BracketView() {
  const { bracketId } = useParams<{ bracketId: string }>()
  const [state, setState] = useState<BracketState | null>(null)
  const [loading, setLoading] = useState(true)
  const [simulating, setSimulating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeSeries, setActiveSeries] = useState<BracketMatchup | null>(null)
  const [exporting, setExporting] = useState(false)
  const treeRef = useRef<HTMLDivElement>(null)

  const fetchState = useCallback(async () => {
    if (!bracketId) return
    try {
      const response = await axios.get<BracketState>(
        `${API_BASE_URL}/bracket/${bracketId}`
      )
      setState(response.data)
    } catch (caught) {
      setError(getBracketError(caught, "Failed to load the bracket."))
    }
  }, [bracketId])

  useEffect(() => {
    setLoading(true)
    fetchState().finally(() => setLoading(false))
  }, [fetchState])

  async function runStep(path: "run-round" | "run-all") {
    if (!bracketId || simulating) return
    setSimulating(true)
    setError(null)
    try {
      await axios.post(`${API_BASE_URL}/bracket/${bracketId}/${path}`)
      // Refresh BracketState from the canonical GET after the mutation.
      await fetchState()
    } catch (caught) {
      setError(getBracketError(caught, "Failed to simulate."))
    } finally {
      setSimulating(false)
    }
  }

  async function handleExport() {
    if (!state) return
    setExporting(true)
    try {
      await exportBracketImage(treeRef.current, {
        size: state.bracket_size,
        seriesFormat: state.series_format,
      })
    } finally {
      setExporting(false)
    }
  }

  if (loading) {
    return (
      <CenteredMessage>
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading bracket…</p>
      </CenteredMessage>
    )
  }

  if (error && !state) {
    return (
      <CenteredMessage>
        <AlertTriangle className="h-6 w-6 text-destructive" />
        <p className="text-sm text-muted-foreground">{error}</p>
        <Button asChild variant="outline" size="sm">
          <Link to="/bracket">
            <ArrowLeft className="h-4 w-4" />
            Back to setup
          </Link>
        </Button>
      </CenteredMessage>
    )
  }

  if (!state) return null

  const complete = state.status === "COMPLETE"
  const totalRounds = state.rounds.length

  return (
    <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-screen-2xl flex-col px-4 py-8 md:px-6">
      <div className="mb-6 flex flex-col gap-4 border-b pb-6 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Link to="/bracket" className="hover:text-foreground">
              GOAT Bracket
            </Link>
            <span>/</span>
            <span>{state.bracket_size}-player · Bo{state.series_format}</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">
            {complete ? "Champion crowned" : "Tournament bracket"}
          </h1>
          <StatusBadge status={state.status} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() => runStep("run-round")}
            disabled={complete || simulating}
          >
            {simulating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <PlayCircle className="h-4 w-4" />
            )}
            Simulate Round
          </Button>
          <Button
            variant="secondary"
            onClick={() => runStep("run-all")}
            disabled={complete || simulating}
          >
            {simulating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FastForward className="h-4 w-4" />
            )}
            Simulate All
          </Button>
          <Button variant="outline" onClick={handleExport} disabled={exporting}>
            {exporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Export Bracket
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-5">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Simulation failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {complete && state.champion && (
        <ChampionBanner champion={state.champion} />
      )}

      {/* The captured node for PNG export (WO-33). */}
      <div ref={treeRef} className="overflow-x-auto pb-4">
        <div className="flex min-w-max gap-6">
          {state.rounds.map((round) => (
            <div
              key={round.round_number}
              className="flex min-w-[18rem] flex-col"
            >
              <div className="mb-3 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {roundName(round.round_number, totalRounds)}
              </div>
              <div className="flex flex-1 flex-col justify-around gap-4">
                {round.matchups.map((matchup, index) => (
                  <MatchupCard
                    key={index}
                    matchup={matchup}
                    onViewSeries={() => setActiveSeries(matchup)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <SeriesSheet
        matchup={activeSeries}
        onOpenChange={(open) => !open && setActiveSeries(null)}
      />
    </div>
  )
}

function StatusBadge({ status }: { status: BracketState["status"] }) {
  const label =
    status === "COMPLETE"
      ? "Complete"
      : status === "IN_PROGRESS"
        ? "In progress"
        : "Ready to simulate"
  return (
    <Badge variant={status === "COMPLETE" ? "default" : "secondary"}>
      {label}
    </Badge>
  )
}

function ChampionBanner({ champion }: { champion: BracketParticipant }) {
  return (
    <div className="mb-6 flex items-center gap-4 rounded-lg border border-amber-500/40 bg-gradient-to-r from-amber-500/15 to-transparent p-4">
      <div className="relative">
        <Headshot
          playerId={champion.player_id}
          className="h-20 w-20 rounded-md ring-2 ring-amber-500"
        />
        <Crown className="absolute -top-3 left-1/2 h-6 w-6 -translate-x-1/2 fill-amber-400 text-amber-500" />
      </div>
      <div>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
          <Trophy className="h-4 w-4" />
          Tournament champion
        </div>
        <div className="text-2xl font-bold">Seed {champion.seed}</div>
        <div className="text-sm text-muted-foreground">
          {champion.season_id} season
        </div>
      </div>
    </div>
  )
}

function MatchupCard({
  matchup,
  onViewSeries,
}: {
  matchup: BracketMatchup
  onViewSeries: () => void
}) {
  const decided = matchup.winner !== null
  const aWon = decided && matchup.winner?.seed === matchup.seed_a
  const bWon = decided && matchup.winner?.seed === matchup.seed_b

  return (
    <div className="rounded-lg border bg-card shadow-sm">
      <ParticipantRow
        participant={matchup.player_a}
        seed={matchup.seed_a}
        wins={matchup.series_wins.a}
        isWinner={aWon}
        isEliminated={bWon}
      />
      <div className="border-t" />
      <ParticipantRow
        participant={matchup.player_b}
        seed={matchup.seed_b}
        wins={matchup.series_wins.b}
        isWinner={bWon}
        isEliminated={aWon}
      />
      {matchup.games.length > 0 && (
        <div className="border-t p-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-full text-xs text-muted-foreground"
            onClick={onViewSeries}
          >
            <ListOrdered className="h-3.5 w-3.5" />
            View Series ({matchup.games.length}{" "}
            {matchup.games.length === 1 ? "game" : "games"})
          </Button>
        </div>
      )}
    </div>
  )
}

function ParticipantRow({
  participant,
  seed,
  wins,
  isWinner,
  isEliminated,
}: {
  participant: BracketParticipant | null
  seed: number | null
  wins: number
  isWinner: boolean
  isEliminated: boolean
}) {
  if (!participant) {
    return (
      <div className="flex items-center gap-3 p-3 text-sm text-muted-foreground">
        <div className="h-9 w-9 shrink-0 rounded-md border border-dashed bg-muted/40" />
        <span className="italic">Awaiting winner</span>
      </div>
    )
  }

  return (
    <div
      className={cn(
        "flex items-center gap-3 p-3 transition-opacity",
        isWinner && "bg-emerald-500/5",
        isEliminated && "opacity-40"
      )}
    >
      <Headshot playerId={participant.player_id} className="h-9 w-9 rounded-md" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <Badge variant="outline" className="h-5 px-1.5 tabular-nums">
            {seed}
          </Badge>
          <span className="truncate">Seed {seed}</span>
          {isWinner && (
            <Trophy className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          )}
        </div>
        <div className="text-xs text-muted-foreground">
          {participant.season_id}
        </div>
      </div>
      <span
        className={cn(
          "text-lg font-bold tabular-nums",
          !isWinner && "text-muted-foreground"
        )}
      >
        {wins}
      </span>
    </div>
  )
}

// Plain <img> (not the Radix Avatar) so WO-33's exporter can add crossOrigin and
// html2canvas can read the NBA CDN pixels without tainting the canvas.
function Headshot({
  playerId,
  className,
}: {
  playerId: number
  className?: string
}) {
  return (
    <img
      src={headshotUrl(playerId)}
      alt=""
      loading="eager"
      onError={(event) => {
        event.currentTarget.style.visibility = "hidden"
      }}
      className={cn("shrink-0 border bg-muted object-cover object-top", className)}
    />
  )
}

function SeriesSheet({
  matchup,
  onOpenChange,
}: {
  matchup: BracketMatchup | null
  onOpenChange: (open: boolean) => void
}) {
  const [gameIndex, setGameIndex] = useState(0)

  // Reset to game 1 whenever a different series is opened.
  useEffect(() => {
    setGameIndex(0)
  }, [matchup])

  const open = matchup !== null
  const games = matchup?.games ?? []
  const game: SimulationResult | undefined = games[gameIndex]
  const [playerAName, playerBName] = game
    ? Object.keys(game.summary.player_stats)
    : ["Player A", "Player B"]

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-2xl"
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <ListOrdered className="h-4 w-4" />
            Series detail
          </SheetTitle>
          <SheetDescription>
            {matchup && matchup.player_a && matchup.player_b
              ? `Seed ${matchup.seed_a} vs Seed ${matchup.seed_b} · series ${matchup.series_wins.a}–${matchup.series_wins.b}`
              : "Per-game play-by-play and match summary."}
          </SheetDescription>
        </SheetHeader>

        {game && (
          <div className="space-y-4 px-4 pb-6">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Game
              </span>
              <Select
                value={String(gameIndex)}
                onValueChange={(value) => setGameIndex(Number(value))}
              >
                <SelectTrigger className="h-8 w-32 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {games.map((_, index) => (
                    <SelectItem key={index} value={String(index)}>
                      Game {index + 1}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <MatchSummaryView
              summary={game.summary}
              playerAName={playerAName}
              playerBName={playerBName}
            />
            <PlayByPlayView playByPlay={game.play_by_play} />
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-screen-xl flex-col items-center justify-center gap-3 px-4 py-8 text-center">
      {children}
    </div>
  )
}

function getBracketError(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail
    if (typeof detail === "string") return detail
    if (error.response?.status === 404) return "Bracket not found."
    if (!error.response) return "Backend is unavailable."
  }
  return fallback
}
