import * as React from "react"
import { useEffect, useState } from "react"
import { Crown, ListOrdered, Trophy } from "lucide-react"

import {
  BracketMatchup,
  BracketParticipant,
  BracketState,
  headshotUrl,
  participantLabel,
} from "@/lib/bracket"
import { SimulationResult } from "@/lib/simulation"
import { cn } from "@/lib/utils"
import { BracketTree } from "@/components/BracketTree"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { MatchSummaryView, PlayByPlayView } from "@/pages/Simulator"

// The running-phase body: a locked NBA-style bracket showing results, plus the
// champion banner once complete. `treeRef` is the node the parent captures for
// PNG export (WO-33).
export function BracketBoard({
  state,
  treeRef,
}: {
  state: BracketState
  treeRef: React.RefObject<HTMLDivElement | null>
}) {
  const [activeSeries, setActiveSeries] = useState<BracketMatchup | null>(null)
  const complete = state.status === "COMPLETE"

  return (
    <>
      {complete && state.champion && <ChampionBanner champion={state.champion} />}

      <div
        ref={treeRef as React.RefObject<HTMLDivElement>}
        className="overflow-x-auto pb-4"
      >
        <BracketTree
          rounds={state.rounds}
          renderMatchup={(matchup) => (
            <MatchupCard
              matchup={matchup}
              onViewSeries={() => setActiveSeries(matchup)}
            />
          )}
        />
      </div>

      <SeriesSheet
        matchup={activeSeries}
        onOpenChange={(open) => !open && setActiveSeries(null)}
      />
    </>
  )
}

function ChampionBanner({ champion }: { champion: BracketParticipant }) {
  return (
    <div className="relative mb-6 flex items-center gap-5 overflow-hidden rounded-2xl border border-amber-500/50 bg-gradient-to-r from-amber-500/20 via-amber-500/10 to-transparent p-5 shadow-lg shadow-amber-500/10">
      {/* Soft radial glow behind the champion for a celebratory feel. */}
      <div className="pointer-events-none absolute -left-10 top-1/2 h-48 w-48 -translate-y-1/2 rounded-full bg-amber-400/20 blur-3xl" />
      <div className="relative shrink-0">
        <div className="absolute inset-0 -z-10 animate-pulse rounded-lg bg-amber-400/30 blur-md" />
        <Headshot
          playerId={champion.player_id}
          className="h-24 w-24 rounded-lg ring-2 ring-amber-500"
        />
        <Crown className="absolute -top-4 left-1/2 h-8 w-8 -translate-x-1/2 fill-amber-400 text-amber-500 drop-shadow" />
      </div>
      <div className="relative">
        <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.2em] text-amber-600 dark:text-amber-400">
          <Trophy className="h-4 w-4" />
          Tournament champion
        </div>
        <div className="mt-0.5 font-display text-4xl font-black uppercase leading-none tracking-tight">
          {participantLabel(champion)}
        </div>
        <div className="mt-1 font-mono text-xs uppercase tracking-wider text-muted-foreground">
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
    <div className="rounded-2xl border bg-card shadow-sm">
      <ParticipantRow
        participant={matchup.player_a}
        wins={matchup.series_wins.a}
        isWinner={aWon}
        isEliminated={bWon}
      />
      <div className="border-t" />
      <ParticipantRow
        participant={matchup.player_b}
        wins={matchup.series_wins.b}
        isWinner={bWon}
        isEliminated={aWon}
      />
      {matchup.games.length > 0 && (
        <div className="border-t p-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-full font-mono text-xs uppercase tracking-wider text-muted-foreground"
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
  wins,
  isWinner,
  isEliminated,
}: {
  participant: BracketParticipant | null
  wins: number
  isWinner: boolean
  isEliminated: boolean
}) {
  if (!participant) {
    return (
      <div className="flex items-center gap-3 p-3 text-sm text-muted-foreground">
        <div className="h-9 w-9 shrink-0 rounded-lg border border-dashed bg-muted/40" />
        <span className="font-mono text-xs uppercase tracking-wider">
          Awaiting winner
        </span>
      </div>
    )
  }

  return (
    <div
      className={cn(
        "relative flex items-center gap-3 p-3 transition-all",
        // A left accent bar plus a tinted background marks the series winner.
        isWinner &&
          "bg-amber-500/10 before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-amber-500",
        isEliminated && "opacity-40"
      )}
    >
      <Headshot
        playerId={participant.player_id}
        className={cn(
          "h-9 w-9 rounded-lg",
          isWinner && "ring-2 ring-amber-500"
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "truncate font-display text-base font-bold uppercase leading-none tracking-tight",
              isWinner && "text-amber-600 dark:text-amber-400"
            )}
          >
            {participantLabel(participant)}
          </span>
          {isWinner && (
            <Trophy className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
          )}
        </div>
        <div className="mt-0.5 font-mono text-xs uppercase tracking-wider text-muted-foreground">
          {participant.season_id}
        </div>
      </div>
      <span
        className={cn(
          "font-mono text-lg font-bold tabular-nums",
          isWinner ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"
        )}
      >
        {wins}
      </span>
    </div>
  )
}

// Plain <img> (not the Radix Avatar) with crossOrigin="anonymous" so the
// BracketExporter's html2canvas pass can read the NBA CDN pixels without
// tainting the canvas (ADR-006).
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
      crossOrigin="anonymous"
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListOrdered className="h-4 w-4" />
            Series detail
          </DialogTitle>
          <DialogDescription>
            {matchup && matchup.player_a && matchup.player_b
              ? `${participantLabel(matchup.player_a)} vs ${participantLabel(matchup.player_b)} · series ${matchup.series_wins.a}–${matchup.series_wins.b}`
              : "Per-game play-by-play and match summary."}
          </DialogDescription>
        </DialogHeader>

        {game && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
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
      </DialogContent>
    </Dialog>
  )
}
