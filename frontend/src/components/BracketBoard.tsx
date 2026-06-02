import * as React from "react"
import { useEffect, useMemo, useRef, useState } from "react"
import { Check, Lock, Network, Rows3, Trophy } from "lucide-react"

import {
  BracketMatchup,
  BracketParticipant,
  BracketRound,
  BracketState,
  headshotUrl,
  participantLabel,
  participantLastName,
} from "@/lib/bracket"
import { SimulationResult } from "@/lib/simulation"
import { cn } from "@/lib/utils"
import { BracketTree } from "@/components/BracketTree"
import { HalftoneAvatar, Kicker } from "@/components/editorial"
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

type BoardView = "round" | "overview"

// Editorial round names by field size, per the running-view spec:
//   16 → Round of 16, Quarterfinals, Semifinals, Final
//    8 → Quarterfinals, Semifinals, Final
//    4 → Semifinals, Final
// (The shared roundName() helper labels the opener "Round 1"; this view wants
// the friendlier "Round of N" framing, so the name is computed locally.)
function bracketRoundName(roundNumber: number, totalRounds: number): string {
  const fromEnd = totalRounds - roundNumber
  if (fromEnd === 0) return "Final"
  if (fromEnd === 1) return "Semifinals"
  if (fromEnd === 2) return "Quarterfinals"
  // Earlier rounds are sized by how many players are still alive entering them.
  const fieldEntering = 2 ** (totalRounds - roundNumber + 1)
  return `Round of ${fieldEntering}`
}

// A round is decided once every one of its matchups has a winner.
function isRoundComplete(round: BracketRound): boolean {
  return round.matchups.every((matchup) => matchup.winner !== null)
}

// The "live" round is the first one still carrying an undecided matchup; when
// every round is settled the tournament is over and we pin to the final.
function liveRoundIndex(rounds: BracketRound[]): number {
  const idx = rounds.findIndex((round) => !isRoundComplete(round))
  return idx === -1 ? rounds.length - 1 : idx
}

// The running-phase body. PRIMARY view is a round-by-round reader (no
// horizontal scroll); a secondary Overview tab shows the classic full tree.
// `treeRef` is the node the parent captures for PNG export (WO-33) — the tree
// stays mounted in the DOM at all times (parked offscreen when the Overview
// tab isn't active) so the export never captures an unmounted/hidden node.
export function BracketBoard({
  state,
  treeRef,
}: {
  state: BracketState
  treeRef: React.RefObject<HTMLDivElement | null>
}) {
  const [activeSeries, setActiveSeries] = useState<BracketMatchup | null>(null)
  const [view, setView] = useState<BoardView>("round")
  const complete = state.status === "COMPLETE"

  const totalRounds = state.rounds.length
  const live = liveRoundIndex(state.rounds)

  // Which round the reader is showing. It follows the simulation forward: every
  // time the live round advances we jump to it, but a manual tab click that the
  // user makes between sims is still honored until the next advance.
  const [selectedRound, setSelectedRound] = useState(live)
  const lastLive = useRef(live)
  useEffect(() => {
    if (live !== lastLive.current) {
      lastLive.current = live
      setSelectedRound(live)
    }
  }, [live])

  // Clamp the selection if the bracket size ever changes underneath us.
  const activeRoundIndex = Math.min(selectedRound, totalRounds - 1)
  const activeRound = state.rounds[activeRoundIndex]

  return (
    <>
      {complete && state.champion && <ChampionBanner champion={state.champion} />}

      <ViewToggle view={view} onChange={setView} />

      {view === "round" ? (
        <div className="animate-in fade-in duration-300 motion-reduce:animate-none">
          <RoundNavigator
            rounds={state.rounds}
            totalRounds={totalRounds}
            liveIndex={live}
            activeIndex={activeRoundIndex}
            onSelect={setSelectedRound}
          />
          <RoundGrid
            round={activeRound}
            roundIndex={activeRoundIndex}
            onViewSeries={setActiveSeries}
          />
        </div>
      ) : null}

      {/* The full tree is the source for the PNG export, so it is ALWAYS
          mounted. On the Round tab it is parked offscreen (absolutely
          positioned, not display:none) so it still lays out and renders — a
          hidden-via-display node would capture blank. On the Overview tab it
          flows normally as the (opt-in, horizontally scrollable) panel. */}
      <div
        className={cn(
          view === "overview"
            ? "animate-in fade-in duration-300 motion-reduce:animate-none"
            : "pointer-events-none absolute -z-50 opacity-0"
        )}
        aria-hidden={view !== "overview"}
        {...(view !== "overview"
          ? { style: { left: "-200vw", top: 0 } as React.CSSProperties }
          : {})}
      >
        <div ref={treeRef as React.RefObject<HTMLDivElement>} className="overflow-x-auto pb-4">
          <BracketTree
            rounds={state.rounds}
            renderMatchup={(matchup, ctx) => (
              <MatchupCard
                matchup={matchup}
                // Stagger the reveal so each round resolves a beat after the
                // last; purely cosmetic CSS, disabled under reduced motion.
                revealDelayMs={ctx.roundNumber * 90 + ctx.matchupIndex * 45}
                onViewSeries={() => setActiveSeries(matchup)}
              />
            )}
          />
        </div>
      </div>

      <SeriesSheet
        matchup={activeSeries}
        onOpenChange={(open) => !open && setActiveSeries(null)}
      />
    </>
  )
}

// Segmented Round / Overview switch. Round is primary; Overview is the classic
// tree for orientation.
function ViewToggle({
  view,
  onChange,
}: {
  view: BoardView
  onChange: (view: BoardView) => void
}) {
  const tabs: { value: BoardView; label: string; icon: React.ReactNode }[] = [
    { value: "round", label: "Round view", icon: <Rows3 className="h-3.5 w-3.5" /> },
    { value: "overview", label: "Full tree", icon: <Network className="h-3.5 w-3.5" /> },
  ]
  return (
    <div className="mb-5 inline-flex items-center gap-1 rounded-sm border bg-card p-1">
      {tabs.map((tab) => {
        const active = tab.value === view
        return (
          <button
            key={tab.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(tab.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 font-condensed text-xs font-bold uppercase tracking-[0.14em] transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}

// Round navigator + progress indicator. Each round is a tab; completed rounds
// are marked done, the live round is highlighted vermillion, and rounds not yet
// reached read as locked/upcoming. Clicking any reached round jumps to it.
function RoundNavigator({
  rounds,
  totalRounds,
  liveIndex,
  activeIndex,
  onSelect,
}: {
  rounds: BracketRound[]
  totalRounds: number
  liveIndex: number
  activeIndex: number
  onSelect: (index: number) => void
}) {
  return (
    <nav
      aria-label="Tournament rounds"
      className="mb-6 flex flex-wrap items-stretch gap-2"
    >
      {rounds.map((round, index) => {
        const done = isRoundComplete(round)
        const isLive = index === liveIndex && !done
        const isActive = index === activeIndex
        // A round is reachable once it's the live round or earlier (i.e. it has
        // started). Future rounds stay locked until the field reaches them.
        const reached = index <= liveIndex
        const label = bracketRoundName(round.round_number, totalRounds)

        return (
          <button
            key={round.round_number}
            type="button"
            aria-current={isActive ? "step" : undefined}
            disabled={!reached}
            onClick={() => reached && onSelect(index)}
            className={cn(
              "group relative flex min-w-[7.5rem] flex-1 flex-col gap-1.5 overflow-hidden rounded-sm border px-3 py-2 text-left transition-colors",
              "disabled:cursor-not-allowed",
              isActive
                ? "border-primary bg-card"
                : reached
                  ? "border-border bg-card hover:border-primary/60"
                  : "border-dashed border-border bg-muted/20"
            )}
          >
            {/* Active round wears the same printed halftone "ink splash" as the
                homepage cover / ISO Lab cards: vermillion dots bleeding from the
                top-right and dissolving down. Painted as an overlay OVER the card
                fill (the .halftone-splash mask would otherwise fade the whole
                box, border and text included). */}
            {isActive && (
              <span
                aria-hidden
                className="halftone-splash pointer-events-none absolute inset-0"
                style={
                  {
                    "--splash-dot":
                      "color-mix(in oklch, var(--primary) 26%, transparent)",
                    backgroundImage:
                      "radial-gradient(var(--splash-dot) 1.2px, transparent 1.7px)",
                    backgroundSize: "8px 8px",
                  } as React.CSSProperties
                }
              />
            )}
            <div className="relative flex items-center justify-between gap-2">
              <span
                className={cn(
                  "kicker",
                  isActive
                    ? "text-primary"
                    : reached
                      ? "text-muted-foreground"
                      : "text-muted-foreground/60"
                )}
              >
                Round {round.round_number}
              </span>
              <RoundStatusDot done={done} isLive={isLive} reached={reached} />
            </div>
            <span
              className={cn(
                "relative font-display text-base font-black uppercase leading-none tracking-tight",
                isActive
                  ? "text-primary"
                  : reached
                    ? "text-foreground"
                    : "text-muted-foreground/60"
              )}
            >
              {label}
            </span>
          </button>
        )
      })}
    </nav>
  )
}

function RoundStatusDot({
  done,
  isLive,
  reached,
}: {
  done: boolean
  isLive: boolean
  reached: boolean
}) {
  if (done) {
    return (
      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <Check className="h-2.5 w-2.5" strokeWidth={3} />
      </span>
    )
  }
  if (isLive) {
    return (
      <span
        aria-label="Now playing"
        className="inline-flex h-2.5 w-2.5 rounded-full bg-primary"
      />
    )
  }
  if (!reached) {
    return <Lock className="h-3 w-3 text-muted-foreground/50" />
  }
  return <span className="h-2.5 w-2.5 rounded-full border border-muted-foreground/40" />
}

// The active round's matchups in a responsive, vertically-stacking grid:
// 1 col on mobile, 2 on md+. The Final is centered as a single feature card.
function RoundGrid({
  round,
  roundIndex,
  onViewSeries,
}: {
  round: BracketRound
  roundIndex: number
  onViewSeries: (matchup: BracketMatchup) => void
}) {
  const isFinal = round.matchups.length === 1
  return (
    <div
      className={cn(
        "grid gap-4",
        isFinal
          ? "mx-auto max-w-md grid-cols-1"
          : "grid-cols-1 md:grid-cols-2"
      )}
    >
      {round.matchups.map((matchup, index) => (
        <MatchupCard
          key={`${roundIndex}-${index}`}
          matchup={matchup}
          // Gentle stagger as the round's cards drop in after a sim.
          revealDelayMs={index * 60}
          onViewSeries={() => onViewSeries(matchup)}
        />
      ))}
    </div>
  )
}

function ChampionBanner({ champion }: { champion: BracketParticipant }) {
  return (
    <div className="relative mb-6 overflow-hidden rounded-sm border border-gold/60 bg-card p-6 text-center animate-in fade-in zoom-in-95 duration-700 [animation-fill-mode:both] motion-reduce:animate-none sm:p-8">
      {/* Printed gold halftone "ink tone" bleeding from the top-right and
          dissolving down — the same newspaper splash as the homepage cover.
          Gold is reserved for this champion moment. */}
      <span
        aria-hidden
        className="halftone-splash pointer-events-none absolute inset-0"
        style={
          {
            "--splash-dot": "color-mix(in oklch, var(--gold) 32%, transparent)",
            backgroundImage:
              "radial-gradient(var(--splash-dot) 1.6px, transparent 2.2px)",
            backgroundSize: "11px 11px",
          } as React.CSSProperties
        }
      />

      {/* Editorial verdict block: eyebrow kicker → printed headshot → name →
          season caption, matching the rest of the site's section voice. */}
      <div className="relative flex flex-col items-center gap-3">
        <Kicker tone="muted">The Verdict</Kicker>
        <HalftoneAvatar
          src={headshotUrl(champion.player_id)}
          alt={participantLabel(champion)}
          fallback={initials(participantLabel(champion))}
          size={92}
          active
          accent="var(--gold)"
        />
        <h2 className="display text-4xl leading-[0.95] text-balance sm:text-5xl">
          {participantLabel(champion)}
        </h2>
        <p className="font-condensed text-xs font-bold uppercase tracking-[0.14em] tabular-nums text-muted-foreground">
          {champion.season_id} · GOAT Bracket Champion
        </p>
      </div>
    </div>
  )
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
}

function MatchupCard({
  matchup,
  revealDelayMs = 0,
  onViewSeries,
}: {
  matchup: BracketMatchup
  revealDelayMs?: number
  onViewSeries: () => void
}) {
  const decided = matchup.winner !== null
  const aWon = decided && matchup.winner?.seed === matchup.seed_a
  const bWon = decided && matchup.winner?.seed === matchup.seed_b

  return (
    <div
      // The reveal animation re-keys whenever the decided state flips, so a
      // freshly simulated round visibly drops its cards in (CSS only).
      key={decided ? "decided" : "open"}
      className="rounded-sm border bg-card animate-in fade-in slide-in-from-bottom-2 duration-500 [animation-fill-mode:both] motion-reduce:animate-none"
      style={{ animationDelay: `${revealDelayMs}ms` }}
    >
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
            className="h-7 w-full font-condensed text-[0.7rem] font-bold uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
            onClick={onViewSeries}
          >
            View Series · {matchup.games.length}{" "}
            {matchup.games.length === 1 ? "Game" : "Games"}
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
        <div className="h-9 w-9 shrink-0 rounded-sm border border-dashed border-border bg-muted/40" />
        <span className="kicker text-muted-foreground">Awaiting winner</span>
      </div>
    )
  }

  return (
    <div
      className={cn(
        "flex items-center gap-3 p-3 transition-all",
        // A tinted background (no rule) marks the series winner.
        isWinner && "bg-primary/10",
        isEliminated && "opacity-40"
      )}
    >
      <Headshot
        playerId={participant.player_id}
        className={cn(
          "h-9 w-9 rounded-sm",
          isWinner && "ring-2 ring-primary"
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span
            title={participantLabel(participant)}
            className={cn(
              "line-clamp-2 font-display text-sm font-bold uppercase leading-tight tracking-tight",
              isWinner && "text-primary"
            )}
          >
            {participantLastName(participant)}
          </span>
          {isWinner && (
            <Trophy className="h-3.5 w-3.5 shrink-0 text-primary" />
          )}
        </div>
        <div className="mt-0.5 font-condensed text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
          {participant.season_id}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        {isWinner && <span aria-hidden className="h-1.5 w-1.5 bg-primary" />}
        <span
          className={cn(
            "font-display text-xl font-black tabular-nums",
            isWinner ? "text-primary" : "text-muted-foreground"
          )}
        >
          {wins}
        </span>
      </div>
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
  const games = useMemo(() => matchup?.games ?? [], [matchup])
  const game: SimulationResult | undefined = games[gameIndex]
  const [playerAName, playerBName] = game
    ? Object.keys(game.summary.player_stats)
    : ["Player A", "Player B"]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <Kicker className="mb-1">The Series</Kicker>
          <DialogTitle className="font-display text-2xl font-black uppercase leading-none tracking-tight">
            {matchup && matchup.player_a && matchup.player_b
              ? `${participantLabel(matchup.player_a)} vs ${participantLabel(matchup.player_b)}`
              : "Series detail"}
          </DialogTitle>
          <DialogDescription>
            {matchup && matchup.player_a && matchup.player_b
              ? `Series ${matchup.series_wins.a}–${matchup.series_wins.b}`
              : "Per-game play-by-play and match summary."}
          </DialogDescription>
        </DialogHeader>

        {game && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <span className="font-condensed text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
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
