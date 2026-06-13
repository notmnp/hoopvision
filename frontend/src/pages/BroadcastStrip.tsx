import {
  type ReactNode,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  Dices,
  Grab,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  SkipForward,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { HalftoneAvatar, Kicker } from "@/components/editorial"
import { Button } from "@/components/ui/button"
import {
  COURT_H,
  COURT_VIEWBOX,
  COURT_W,
  CourtLines,
  HOOP,
  RIM_R,
  PLAYER_HOME,
  ZONE_POSITIONS,
  bandFromBasic,
  quadAt,
  shotPoint,
} from "@/lib/court"
import {
  type ActiveShot,
  type LiveEventKind,
  activeEventAt,
  activeShotAt,
  boxScoreThrough,
  clamp01,
  emptyStatLine,
  enrichPlays,
  type EnrichedPlay,
  formatClock,
  frac,
  type LiveStatLine,
  pointsForPlay,
  resolveSides,
  shotDescriptor,
  type ZoneSplit,
  zoneFgPct,
  zoneSplitsThrough,
} from "@/lib/liveGame"
import { formatPct, gradeZone } from "@/lib/shotEfficiency"
import { useLiveGame, type PlaybackSpeed } from "@/hooks/useLiveGame"
import { MatchSummary, PlayByPlay, SimulationResult } from "@/lib/simulation"

const SPEEDS: PlaybackSpeed[] = [1, 2, 4]

// The single family of on-court mark sizes, so the shot dots and the foul/steal
// glyphs read as one set rather than slightly different sizes.
const DOT_R = 6 // a settled shot dot AND the event-glyph disc
const HOVER_PAD = 5 // hover ring = mark radius + this
const HIT_R = 14 // invisible hover/focus target (same for dots and glyphs)
const BALL_R = 4.2 // the in-flight ball head / carom / drop-through

// A foul/steal glyph's brief swell as it happens (a pure function of the
// flourish progress `t`), shared by both EventFx branches.
const eventSwell = (t: number) => 1 + 0.35 * Math.sin(clamp01(t * 1.2) * Math.PI)

// SVG transform string that scales `scale` about the point (x, y) — scale() is
// origin-relative, so the translate by x(1-scale) keeps that point fixed.
const scaleAbout = (x: number, y: number, scale: number) =>
  `translate(${x * (1 - scale)} ${y * (1 - scale)}) scale(${scale})`

type Live = ReturnType<typeof useLiveGame>

interface LivePlayer {
  player_id: number
  name: string
}

// An inline broadcast of an already-computed 1v1 game, laid out like a printed
// sports page: scoreboard plate up top, the court diagram (with the transport
// directly beneath it) on the left, the play-by-play wire + win-probability
// chart on the right. At the final whistle the court becomes a two-player
// shot-chart comparison and the live box becomes the Game Story — the settled
// box score with the winner called. Everything is flat ink-on-paper: hairline
// borders, halftone texture, the two design data tones as the only hues.
export default function BroadcastStrip({
  result,
  playerA,
  playerB,
  billing,
  onRerun,
  rerunDisabled,
  warningsSlot,
}: {
  result: SimulationResult
  playerA: LivePlayer
  playerB: LivePlayer
  billing?: string | null
  onRerun?: () => void
  rerunDisabled?: boolean
  warningsSlot?: ReactNode
}) {
  const plays = result.play_by_play
  // The OS reduced-motion preference is the only thing that suppresses the
  // per-shot animation (the old "Auto-skip" override was removed).
  const reduced = usePrefersReducedMotion()

  // The replay engine, parked at the final whistle (Infinity clamps to the
  // game's full length). The broadcast NEVER auto-plays: every run opens "on
  // the shelf" — score, Game Story and shot chart settled up front — and the
  // full animated replay (countdown, shot arcs, the lot) is opt-in via the
  // "Watch how the game unfolded" button.
  const live = useLiveGame(plays, false, Number.POSITIVE_INFINITY)
  const finished = live.finished

  // The intro phase machine: "shelf" (parked at the final, watch button armed),
  // "countdown" (the on-court 3-2-1 before the tip), "rolling" (playback owns
  // the clock). Reduced-motion viewers never see the countdown.
  const [phase, setPhase] = useState<"shelf" | "countdown" | "rolling">("shelf")
  const [countdown, setCountdown] = useState(3)
  const countingDown = phase === "countdown"
  const shelf = phase === "shelf"

  useEffect(() => {
    if (phase !== "countdown") return
    if (countdown <= 0) {
      setPhase("rolling")
      return
    }
    const timer = window.setTimeout(() => setCountdown((c) => c - 1), 650)
    return () => window.clearTimeout(timer)
  }, [phase, countdown])

  // Entering "rolling" starts playback; play() restarts from the tip when the
  // clock is parked at the final whistle (the shelf → watch transition).
  useEffect(() => {
    if (phase === "rolling") live.play()
    // live.play is stable for a given game.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // The settled (post-game) presentation: at the final whistle AND not mid-intro.
  // During the watch-button countdown the clock is still parked at the end, so
  // `finished` alone would leak the result back onto the screen.
  const settled = finished && !countingDown

  // Nothing is "revealed" until tip-off — otherwise possession 0 (whose timeline
  // slot starts at t=0) would leak its outcome onto the scoreboard, the live box
  // and the wire while the countdown is still running.
  const shown = countingDown ? 0 : live.revealedCount

  const { nameA, nameB } = useMemo(
    () => resolveSides(plays, playerA.name, playerB.name),
    [plays, playerA.name, playerB.name]
  )
  // The two players are always the design's data tones — vermillion (the house
  // accent) for A, ink-blue (the established "secondary data tone") for B. Both
  // are theme tokens, so they adapt to Paper/Ink, and being fixed they're always
  // maximally distinct (team colours risked two reds or two blues reading the
  // same). CSS vars, used directly as SVG/CSS colours throughout.
  const colorA = "var(--primary)"
  const colorB = "var(--ink-blue)"
  const enriched = useMemo(() => enrichPlays(plays, nameA), [plays, nameA])

  const current = shown > 0 ? plays[shown - 1] : null
  const scoreA = current ? current.score_a : 0
  const scoreB = current ? current.score_b : 0
  const possessionSide: "a" | "b" | null =
    current && !settled
      ? current.offensive_player === nameA
        ? "a"
        : "b"
      : null

  const [filter, setFilter] = useState<"a" | "b" | null>(null)
  // Any explicit jump into the timeline takes over from the shelf/intro.
  const jump = (seconds: number) => {
    setPhase("rolling")
    live.seek(seconds)
    live.play()
  }
  const replay = () => {
    setFilter(null)
    setPhase("rolling")
    live.seek(0)
    live.play()
  }
  // The shelf's "Watch how the game unfolded": run the 3-2-1, then the rolling
  // effect rewinds to the tip and plays. OS-level reduced-motion skips the
  // countdown and the shot animation, as it must.
  const watch = () => {
    if (reduced) {
      setPhase("rolling")
      return
    }
    setCountdown(3)
    setPhase("countdown")
  }

  return (
    <section className="mt-6 space-y-3">
      {/* Scoreboard plate — flat card, hairline border (no glassy blur). The
          center clock/status column is framed with vertical rules so the whole
          thing reads like a printed scorecard rather than an app status bar. */}
      <div className="overflow-hidden rounded-sm border border-border bg-card">
        <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-2 py-2 pl-3 pr-3 sm:gap-4">
          <TeamPlate
            player={playerA}
            score={scoreA}
            color={colorA}
            leading={scoreA > scoreB}
            hasBall={possessionSide === "a"}
            winner={settled && scoreA > scoreB}
            align="right"
            reduced={reduced}
          />
          <CenterColumn
            clockSeconds={countingDown ? 0 : live.clockSeconds}
            finished={settled}
            billing={billing}
            reduced={reduced}
          />
          <TeamPlate
            player={playerB}
            score={scoreB}
            color={colorB}
            leading={scoreB > scoreA}
            hasBall={possessionSide === "b"}
            winner={settled && scoreB > scoreA}
            align="left"
            reduced={reduced}
          />
        </div>
      </div>

      {/* Body: court + transport + box (left), play-by-play + odds (right).
          The right column never drives the row height — it absolutely fills its
          cell and scrolls internally, so the court can never slide behind it. */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)]">
        {/* Left column */}
        <div className="flex min-w-0 flex-col gap-2">
          {/* Fixed height so the row never grows when the shot-chart filter
              toggle appears at the final whistle — the court below stays put
              instead of jumping down. */}
          <div className="flex min-h-8 shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <div className="flex items-center gap-3 kicker text-muted-foreground">
              <Kicker tone="muted">{settled ? "The Shot Chart" : "The Floor"}</Kicker>
              <LegendDot color={colorA} label={lastName(nameA)} />
              <LegendDot color={colorB} label={lastName(nameB)} />
              <span className="hidden items-center gap-1 sm:flex">
                <span className="size-2 rounded-full border border-muted-foreground/60" />
                open = miss
              </span>
            </div>
            {settled && !shelf && <FilterToggle value={filter} onChange={setFilter} nameA={nameA} nameB={nameB} />}
          </div>

          <div className="relative">
            <FloorStage
              plays={plays}
              revealedCount={shown}
              currentPossession={current?.possession ?? null}
              nameA={nameA}
              colorA={colorA}
              colorB={colorB}
              reduced={reduced}
              showFx={!settled}
              started={!countingDown}
              filterSide={settled ? filter : null}
              clockSeconds={live.clockSeconds}
              timings={live.timings}
            />
            {countingDown && (
              <CountdownOverlay
                nameA={nameA}
                nameB={nameB}
                colorA={colorA}
                colorB={colorB}
                count={countdown}
              />
            )}
            {/* The shelf: the settled chart sits softly blurred behind the one
                action that matters — replaying the game you already have the
                verdict for. Opt-in motion instead of forced motion. */}
            {shelf && (
              <div className="absolute inset-0 z-20 flex items-center justify-center rounded-sm bg-background/35 backdrop-blur-[2px]">
                <Button
                  variant="default"
                  onClick={watch}
                  className="font-condensed font-bold uppercase tracking-[0.14em]"
                >
                  <Play className="h-4 w-4" />
                  Watch the game
                </Button>
              </div>
            )}
          </div>

          {/* The transport sits directly under the court, like a film scrubber
              under its frame. At the final it swaps for the replay/re-run pair
              (on the shelf the watch button already covers the replay). */}
          {settled ? (
            <div className="flex items-center justify-center gap-2 py-1">
              {!shelf && (
                <Button
                  variant="outline"
                  onClick={replay}
                  className="font-condensed font-bold uppercase tracking-[0.14em]"
                >
                  <RotateCcw className="h-4 w-4" />
                  Watch the game again
                </Button>
              )}
              {onRerun && (
                <Button
                  variant={shelf ? "outline" : "default"}
                  onClick={onRerun}
                  disabled={rerunDisabled}
                  className="font-condensed font-bold uppercase tracking-[0.14em]"
                >
                  {rerunDisabled ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Dices className="h-4 w-4" />
                  )}
                  Run it back
                </Button>
              )}
            </div>
          ) : (
            <Transport live={live} />
          )}

          <GameBox
            plays={plays}
            revealedCount={shown}
            nameA={nameA}
            nameB={nameB}
            colorA={colorA}
            colorB={colorB}
            finished={settled}
            summary={summaryOrNull(result.summary, settled)}
            warningsSlot={warningsSlot}
          />
        </div>

        {/* Right column: play-by-play wire + win-probability footer */}
        <div className="relative h-[30rem] min-w-0 lg:h-auto">
          <WireFeed
            enriched={enriched}
            timings={live.timings}
            revealedCount={shown}
            currentPossession={current?.possession ?? null}
            nameA={nameA}
            colorA={colorA}
            colorB={colorB}
            reduced={reduced}
            finished={settled}
            seek={jump}
            footer={
              <OddsGraph
                enriched={enriched}
                timings={live.timings}
                revealedCount={shown}
                finished={settled}
                nameA={nameA}
                nameB={nameB}
                colorA={colorA}
                colorB={colorB}
                reduced={reduced}
                winProb={result.win_probability ?? []}
                onJump={jump}
              />
            }
          />
        </div>
      </div>
    </section>
  )
}

// The Game Story header only makes sense once the game is settled; while live,
// the box renders without the summary chrome.
function summaryOrNull(summary: MatchSummary | undefined, finished: boolean) {
  return finished ? summary ?? null : null
}

/* -------------------------------------------------------------------------- */
/* Scoreboard                                                                 */
/* -------------------------------------------------------------------------- */

function TeamPlate({
  player,
  score,
  color,
  leading,
  hasBall,
  winner,
  align,
  reduced,
}: {
  player: LivePlayer
  score: number
  color: string
  leading: boolean
  hasBall: boolean
  winner: boolean
  align: "left" | "right"
  reduced: boolean
}) {
  const pip = (
    <span
      aria-label={hasBall ? "has possession" : undefined}
      className={cn(
        "size-2.5 shrink-0 rounded-full transition-opacity",
        hasBall ? "opacity-100" : "opacity-0",
        hasBall && !reduced && "animate-pulse"
      )}
      style={{ backgroundColor: color }}
    />
  )
  const nameBlock = (
    <div className={cn("min-w-0", align === "right" ? "text-right" : "text-left")}>
      <div className="truncate display text-sm leading-none sm:text-xl">{player.name}</div>
      {/* Fixed-height slot holding either the leading underline or the "Winner"
          tag, so swapping between them (live → final) never changes the plate's
          height and shifts the scoreboard. */}
      <div className={cn("mt-1 flex h-3.5 items-center", align === "right" ? "justify-end" : "justify-start")}>
        {winner ? (
          <span className="kicker leading-none text-primary">Winner</span>
        ) : (
          <span
            className={cn("h-0.5 w-8 rounded-full transition-opacity", leading ? "opacity-100" : "opacity-30")}
            style={{ backgroundColor: color }}
          />
        )}
      </div>
    </div>
  )
  const avatar = (
    <HalftoneAvatar
      src={`https://cdn.nba.com/headshots/nba/latest/1040x760/${player.player_id}.png`}
      alt={player.name}
      fallback={initials(player.name)}
      size={40}
      active
      accent={color}
      className="hidden shrink-0 sm:block"
    />
  )
  const scoreFigure = <CountUpScore value={score} color={color} />

  return (
    <div className={cn("flex min-w-0 items-center gap-2 sm:gap-3", align === "right" ? "justify-end" : "justify-start")}>
      {align === "right" ? (
        <>
          {pip}
          {avatar}
          {nameBlock}
          {scoreFigure}
        </>
      ) : (
        <>
          {scoreFigure}
          {nameBlock}
          {avatar}
          {pip}
        </>
      )}
    </div>
  )
}

// The scoreboard score: rolling digits (odometer feel) that don't clip the
// Fraunces numerals, plus a "+2/+3" that pops out when the score rises.
function CountUpScore({ value, color }: { value: number; color: string }) {
  const reduced = usePrefersReducedMotion()
  const pop = useScoreDelta(value)
  const tens = Math.floor(value / 10)
  const showTens = value >= 10
  return (
    <span
      className="stat-figure relative inline-flex min-w-[2ch] items-center justify-center text-4xl leading-none tabular-nums sm:text-5xl"
      style={{ color }}
      aria-label={String(value)}
      aria-live="polite"
    >
      {reduced ? (
        <span>{value}</span>
      ) : (
        <span className="inline-flex" aria-hidden>
          {showTens && <RollDigit key="tens" digit={tens} place={1} />}
          <RollDigit key="ones" digit={value % 10} place={0} />
        </span>
      )}
      {!reduced && pop && (
        <span
          key={pop.id}
          className={cn("score-pop", pop.delta >= 3 && "score-pop--3")}
          style={{ color }}
          aria-hidden
        >
          +{pop.delta}
        </span>
      )}
    </span>
  )
}

// One rolling decimal digit. A stateless 0–9 strip translated so the target
// digit lands in a window taller/wider than the glyph ink (no clipping). Purely
// a function of `digit` — no internal state — so it can never show a stale or
// scrambled value when the tens column appears/disappears.
function RollDigit({ digit, place }: { digit: number; place: number }) {
  return (
    <span className="roll-window">
      <span
        className="roll-strip"
        style={{
          transform: `translateY(calc(${-digit} * var(--digit-h)))`,
          transitionDelay: `${place * 40}ms`,
        }}
      >
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
          <span key={d} className="roll-cell">
            {d}
          </span>
        ))}
      </span>
    </span>
  )
}

function useScoreDelta(value: number): { id: number; delta: number } | null {
  const prev = useRef(value)
  const [pop, setPop] = useState<{ id: number; delta: number } | null>(null)
  useEffect(() => {
    const delta = value - prev.current
    prev.current = value
    if (delta > 0) {
      const id = performance.now()
      setPop({ id, delta })
      const timer = window.setTimeout(
        () => setPop((p) => (p?.id === id ? null : p)),
        1000
      )
      return () => window.clearTimeout(timer)
    }
  }, [value])
  return pop
}

function CenterColumn({
  clockSeconds,
  finished,
  billing,
  reduced,
}: {
  clockSeconds: number
  finished: boolean
  billing?: string | null
  reduced: boolean
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 self-stretch border-x border-border/60 bg-muted/15 px-3 sm:px-6">
      {/* Fixed-height status slot so the LIVE pill (taller than the "Final"
          kicker) doesn't change the scoreboard's height when the game ends or
          the replay starts. */}
      <div className="flex h-5 items-center justify-center">
        {finished ? (
          <Kicker tone="muted">Final</Kicker>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-sm border border-court/40 bg-court/10 px-2 py-0.5 font-condensed text-[0.7rem] font-bold uppercase tracking-[0.14em] text-court">
            <span className={cn("size-1.5 rounded-full bg-court", !reduced && "animate-pulse")} />
            Live
          </span>
        )}
      </div>
      <div className="stat-figure text-2xl leading-none tabular-nums sm:text-3xl">{formatClock(clockSeconds)}</div>
      {billing && !finished ? (
        <span className="max-w-[42vw] truncate font-display text-xs font-bold italic text-primary sm:hidden">{billing}</span>
      ) : (
        <span className="kicker hidden text-muted-foreground sm:block">First to 21</span>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* The floor                                                                  */
/* -------------------------------------------------------------------------- */

const isShot = (play: PlayByPlay) => play.result === "made" || play.result === "missed"
const isEvent = (play: PlayByPlay) => !isShot(play) && (play.foul || play.turnover)
const pct = (value: number, span: number) => (value / span) * 100

// A persistent spot for a non-shot possession. These have no shot location, so
// they're placed where the play would actually happen on the floor — NOT out at
// the arc. A DRAWN FOUL hugs the rim/paint (drives, and-ones, post contact); a
// TURNOVER sits in the paint-to-midrange handling area (strips, charges, bad
// passes). Within each band, events are laid out by their ORDER (not a hash of
// the possession number, which piled them up) via an R2 low-discrepancy
// sequence, so any number of them fill the band evenly and stay separated. Each
// player keeps to their own half (A above the rim line, B below) so the colour
// isn't the only cue. Deterministic — a spot survives replays, scrubs, filters.
const EVENT_BANDS: Record<
  LiveEventKind,
  Record<"a" | "b", { x: number; y: number; w: number; h: number }>
> = {
  // Drawn fouls: in and just outside the paint, right at the basket.
  foul: {
    a: { x: 62, y: 114, w: 118, h: 82 },
    b: { x: 62, y: 204, w: 118, h: 82 },
  },
  // Turnovers: deeper paint out to the free-throw line / short midrange.
  turnover: {
    a: { x: 150, y: 110, w: 142, h: 86 },
    b: { x: 150, y: 204, w: 142, h: 86 },
  },
}
// 1/plastic and 1/plastic^2 — the R2 sequence's two irrational increments.
const R2_A1 = 0.7548776662466927
const R2_A2 = 0.5698402909980532
function eventSpotByIndex(side: "a" | "b", kind: LiveEventKind, index: number) {
  const band = EVENT_BANDS[kind][side]
  const n = index + 1
  const u = frac(0.5 + R2_A1 * n)
  const v = frac(0.5 + R2_A2 * n)
  return { x: band.x + u * band.w, y: band.y + v * band.h }
}

const FloorStage = memo(function FloorStage({
  plays,
  revealedCount,
  currentPossession,
  nameA,
  colorA,
  colorB,
  reduced,
  showFx,
  started,
  filterSide,
  clockSeconds,
  timings,
}: {
  plays: PlayByPlay[]
  revealedCount: number
  currentPossession: number | null
  nameA: string
  colorA: string
  colorB: string
  reduced: boolean
  showFx: boolean
  started: boolean
  filterSide: "a" | "b" | null
  clockSeconds: number
  timings: { start: number; duration: number }[]
}) {
  const [hovered, setHovered] = useState<number | null>(null)
  const [hoveredZone, setHoveredZone] = useState<string | null>(null)
  const sideOf = (play: PlayByPlay): "a" | "b" => (play.offensive_player === nameA ? "a" : "b")

  const shots = useMemo(
    () =>
      plays
        .slice(0, revealedCount)
        .filter(isShot)
        .filter((play) => !filterSide || sideOf(play) === filterSide),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plays, revealedCount, filterSide, nameA]
  )

  // Zone-efficiency heat (final, single-player views only).
  const heat = useMemo(() => {
    if (showFx || !filterSide) return null
    const cells = zoneSplitsThrough(plays, revealedCount, nameA)
    const zones = Object.values(cells)
      .map((cell) => ({ key: cell.key, split: filterSide === "a" ? cell.a : cell.b }))
      .filter((z) => z.split.att > 0 && ZONE_POSITIONS[z.key])
    const maxAtt = zones.reduce((m, z) => Math.max(m, z.split.att), 0)
    return { zones, maxAtt }
  }, [showFx, filterSide, plays, revealedCount, nameA])

  // Heat + dots are memoized so the per-frame ball motion (driven by
  // clockSeconds) never reconciles the heavy accumulating shot list. The heat
  // grades each zone green / ochre / red by that player's FG% in its band.
  const heatEls = useMemo(
    () =>
      heat?.zones.map((z) => {
        const pos = ZONE_POSITIONS[z.key]
        const [basic, area] = z.key.split("|")
        const fg = zoneFgPct(z.split)
        const grade = gradeZone(bandFromBasic(basic), fg, z.split.att)
        const r = 16 + 30 * (heat.maxAtt > 0 ? z.split.att / heat.maxAtt : 0)
        return (
          <g
            key={z.key}
            tabIndex={0}
            role="img"
            aria-label={`${basic} ${area}: ${z.split.made} of ${z.split.att}, ${formatPct(fg)}`}
            className="cursor-pointer outline-none"
            onMouseEnter={() => setHoveredZone(z.key)}
            onMouseLeave={() => setHoveredZone((v) => (v === z.key ? null : v))}
            onFocus={() => setHoveredZone(z.key)}
            onBlur={() => setHoveredZone((v) => (v === z.key ? null : v))}
          >
            <circle cx={pos.x} cy={pos.y} r={r} fill={grade.fill} />
            <circle cx={pos.x} cy={pos.y} r={r} fill="none" stroke={grade.stroke} strokeWidth={1.25} />
          </g>
        )
      }) ?? null,
    [heat]
  )

  const hoveredZoneCell = hoveredZone
    ? heat?.zones.find((z) => z.key === hoveredZone) ?? null
    : null

  const dotEls = useMemo(
    () =>
      shots.map((play) => {
        const { x, y } = shotPoint(play.shot_zone_basic, play.shot_zone_area, play.possession)
        const made = play.result === "made"
        const color = sideOf(play) === "a" ? colorA : colorB
        const isNewest = play.possession === currentPossession
        // One fixed radius for every dot (newest included) so a settling dot
        // never changes size — "newest" is signalled by the pulse ring + drop
        // animation, not a size pop. A separate, larger, invisible hit target
        // makes both makes and the hollow misses easy and stable to acquire.
        const isHover = play.possession === hovered
        return (
          <g
            key={play.possession}
            tabIndex={0}
            role="button"
            aria-label={`${play.offensive_player}, ${shotDescriptor(play)}, ${made ? "made" : "missed"}`}
            className="cursor-pointer outline-none"
            onMouseEnter={() => setHovered(play.possession)}
            onMouseLeave={() => setHovered((v) => (v === play.possession ? null : v))}
            onFocus={() => setHovered(play.possession)}
            onBlur={() => setHovered((v) => (v === play.possession ? null : v))}
          >
            <circle cx={x} cy={y} r={HIT_R} fill="transparent" stroke="none" />
            {isNewest && showFx && !reduced && (
              <circle cx={x} cy={y} r={DOT_R + HOVER_PAD + 2} fill="none" className="animate-pulse" style={{ stroke: color, pointerEvents: "none" }} strokeWidth={1.5} opacity={0.4} />
            )}
            <circle
              cx={x}
              cy={y}
              r={DOT_R}
              fill={made ? color : "none"}
              stroke={made ? "none" : color}
              strokeWidth={made ? 0 : 2.2}
              style={{ pointerEvents: "none" }}
              className={cn(isNewest && showFx && !reduced && "animate-dot-drop")}
            />
            {isHover && <circle cx={x} cy={y} r={DOT_R + HOVER_PAD} fill="none" style={{ stroke: color, pointerEvents: "none" }} strokeWidth={1.25} opacity={0.6} />}
          </g>
        )
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shots, colorA, colorB, currentPossession, hovered, reduced, showFx, nameA]
  )

  // Each event's spot, computed over the WHOLE game (not the revealed/filtered
  // slice) and keyed by possession, so a player's k-th event always lands in
  // the same sunflower slot regardless of how many are shown or whether the
  // filter is on. Read by both the glyphs and the hover tooltip.
  const eventSpots = useMemo(() => {
    const map = new Map<number, { x: number; y: number }>()
    const counts = { "a-foul": 0, "a-turnover": 0, "b-foul": 0, "b-turnover": 0 }
    for (const play of plays) {
      if (!isEvent(play)) continue
      const side = sideOf(play)
      const kind: LiveEventKind = play.turnover ? "turnover" : "foul"
      map.set(play.possession, eventSpotByIndex(side, kind, counts[`${side}-${kind}`]++))
    }
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plays, nameA])

  // Non-shot possessions (drawn fouls, steals) left as persistent, hoverable
  // marks on the floor — same accumulation/filtering rules as the shot dots.
  const events = useMemo(
    () =>
      plays
        .slice(0, revealedCount)
        .filter(isEvent)
        .filter((play) => !filterSide || sideOf(play) === filterSide),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plays, revealedCount, filterSide, nameA]
  )

  const eventEls = useMemo(
    () =>
      events.map((play) => {
        const { x, y } = eventSpots.get(play.possession) ?? PLAYER_HOME[sideOf(play)]
        // Coloured by PLAYER (matching the shot dots), so the glyph's icon —
        // whistle vs. steal-hand — is the only thing that signals foul vs.
        // turnover, while the colour tells you whose it is.
        const color = sideOf(play) === "a" ? colorA : colorB
        const isNewest = play.possession === currentPossession
        const isHover = play.possession === hovered
        return (
          <g
            key={play.possession}
            tabIndex={0}
            role="button"
            aria-label={`${play.offensive_player}, ${shotDescriptor(play)}`}
            className="cursor-pointer outline-none"
            onMouseEnter={() => setHovered(play.possession)}
            onMouseLeave={() => setHovered((v) => (v === play.possession ? null : v))}
            onFocus={() => setHovered(play.possession)}
            onBlur={() => setHovered((v) => (v === play.possession ? null : v))}
          >
            <circle cx={x} cy={y} r={HIT_R} fill="transparent" stroke="none" />
            <EventGlyph
              kind={play.turnover ? "turnover" : "foul"}
              cx={x}
              cy={y}
              r={DOT_R}
              color={color}
              pop={isNewest && showFx && !reduced}
            />
            {isHover && <circle cx={x} cy={y} r={DOT_R + HOVER_PAD} fill="none" style={{ stroke: color, pointerEvents: "none" }} strokeWidth={1.25} opacity={0.6} />}
          </g>
        )
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, eventSpots, hovered, currentPossession, showFx, reduced, colorA, colorB, nameA]
  )

  const hoveredPlay =
    hovered != null
      ? shots.find((p) => p.possession === hovered) ??
        events.find((p) => p.possession === hovered) ??
        null
      : null

  // The shot projectile — present only while a shot is in flight; a pure
  // function of the clock, so pause/scrub/speed all work for free.
  const shot = showFx && !reduced ? activeShotAt(clockSeconds, plays, timings) : null
  const shotPlay = shot ? plays.find((p) => p.possession === shot.possession) : null
  const shotColor = shotPlay && sideOf(shotPlay) === "a" ? colorA : colorB

  // The non-shot flourish — a whistle's sound-rings for a drawn foul, a swipe +
  // loose ball for a steal — at the event's spot, in the player's colour. Also
  // a pure function of the clock.
  const event = showFx && !reduced ? activeEventAt(clockSeconds, plays, timings) : null
  const eventPlay = event ? plays.find((p) => p.possession === event.possession) : null
  const eventXY = event ? eventSpots.get(event.possession) : null
  const eventColor = eventPlay && sideOf(eventPlay) === "a" ? colorA : colorB

  // The court is width-driven (w-full + the viewBox's aspect ratio), so it can
  // never overflow its grid column and slide behind the play-by-play. Flat,
  // straight-on — a printed diagram, per the design system (no camera tilt).
  return (
    <div className="relative mx-auto aspect-[564/400] w-full max-w-[680px] lg:max-w-none">
      {/* Square-cornered, solid floor with a SINGLE hairline frame (the court's
          outer boundary line is drawn by this border, not also by CourtLines).
          Atmosphere is the IDENTICAL halftone field the ISO Lab player cards use
          — the .halftone-splash corner-bleed mask (dense top-right, dissolving
          bottom-left) overridden to the same finer 9px grid / 1.4px dots — only
          the dot colour stays the neutral theme token instead of a team hue. */}
      <div className="absolute inset-0 overflow-hidden border bg-muted/20">
        <span
          aria-hidden
          className="halftone-splash pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(var(--splash-dot) 1.4px, transparent 1.9px)",
            backgroundSize: "9px 9px",
          }}
        />
        <svg viewBox={COURT_VIEWBOX} className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid meet">
          <CourtLines />
          {heatEls}
          {/* Nothing populates the floor until tip-off — the court stays empty
              under the 3-2-1 countdown rather than showing the players (and
              possession 0's dot) early. */}
          {started && (
            <>
              {dotEls}
              {eventEls}

              {/* The shot in flight: an ink trace in the shooter's accent —
                  solid for a make, dashed for a miss — and, on a make, a rim
                  flash + ripple + a small burst of action ticks. */}
              {shot && <ShotFx shot={shot} color={shotColor} />}

              {/* The non-shot flourish: a blown whistle (foul) or a loose
                  ball (steal), fired at the moment the event happens. */}
              {event && eventXY && (
                <EventFx kind={event.kind} x={eventXY.x} y={eventXY.y} color={eventColor} t={event.t} />
              )}
            </>
          )}
        </svg>
      </div>

      {hoveredPlay && (
        <ShotTooltip
          play={hoveredPlay}
          color={sideOf(hoveredPlay) === "a" ? colorA : colorB}
          at={
            isEvent(hoveredPlay)
              ? eventSpots.get(hoveredPlay.possession) ?? PLAYER_HOME[sideOf(hoveredPlay)]
              : shotPoint(hoveredPlay.shot_zone_basic, hoveredPlay.shot_zone_area, hoveredPlay.possession)
          }
        />
      )}
      {hoveredZoneCell && <ZoneDetail zoneKey={hoveredZoneCell.key} split={hoveredZoneCell.split} />}
    </div>
  )
})

function ZoneDetail({ zoneKey, split }: { zoneKey: string; split: ZoneSplit }) {
  const [basic, area] = zoneKey.split("|")
  const pos = ZONE_POSITIONS[zoneKey]
  if (!pos) return null
  const fg = zoneFgPct(split)
  const grade = gradeZone(bandFromBasic(basic), fg, split.att)
  const left = Math.min(82, Math.max(18, pct(pos.x, COURT_W)))
  const above = pos.y > COURT_H / 2
  return (
    <div
      className="pointer-events-none absolute z-20 w-max max-w-[70%] -translate-x-1/2 rounded-sm border border-border bg-background/95 px-2.5 py-1.5 shadow-sm"
      style={{ left: `${left}%`, top: `${pct(pos.y, COURT_H)}%`, transform: `translate(-50%, ${above ? "calc(-100% - 10px)" : "10px"})` }}
    >
      <div className="flex items-center gap-1.5">
        <span className="size-2 shrink-0 rounded-sm" style={{ backgroundColor: grade.stroke }} />
        <span className="truncate display text-sm leading-none">{basic} · {area}</span>
      </div>
      <div className="mt-1 flex items-center gap-2 kicker text-muted-foreground tabular-nums">
        <span>{split.made}/{split.att} FG</span>
        <span className="text-foreground">{formatPct(fg)}</span>
      </div>
    </div>
  )
}

// The shot in flight, drawn like a printer's diagram of a play: a thin ink
// trace in the shooter's accent color — solid when it's going in, dashed when
// it isn't (the print convention for a path not taken) — with a small ball head
// riding the arc.
//
// The landing is where the print character lives, and both outcomes are pure
// functions of the clock (no keyed CSS), so pause / scrub / speed replay them:
// — A MAKE drops THROUGH the hoop: seen from above, the ball shrinks away into
//   the ring while the rim flashes, one ink ripple rolls outward (a stone in
//   water), and a burst of short radial action ticks — the comic-print "pow" —
//   fires around the iron. A three earns a bigger burst than a two.
// — A MISS contacts the rim at its per-possession point (front iron, side rim;
//   see shotArc) and CAROMS radially off it with a little hop before fading.
function ShotFx({ shot, color }: { shot: ActiveShot; color: string }) {
  const { possession, launch, control, end, made, three, arcT, fadeT } = shot
  // The trace: sample the arc from the launch up to the current flight progress.
  const steps = 18
  const maxT = Math.max(arcT, 0.001)
  let d = ""
  for (let s = 0; s <= steps; s++) {
    const p = quadAt(launch, control, end, (s / steps) * maxT)
    d += `${s === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)} `
  }
  const head = quadAt(launch, control, end, arcT)
  const traceOpacity = 0.85 * (1 - fadeT)
  const kick = frac(Math.sin((possession + 1) * 31.7))

  // Make: burst eases out hard so the pow lands instantly, then relaxes.
  const burst = 1 - (1 - fadeT) ** 2.2
  const tickCount = three ? 12 : 8
  const ticks = Array.from({ length: tickCount }, (_, i) => {
    const angle = (i / tickCount) * Math.PI * 2 + kick * 0.6
    // Per-tick deterministic length so the burst reads hand-set, not mechanical.
    const len =
      (three ? 12 : 8) * (0.6 + 0.8 * frac(Math.sin((possession + 1) * 7.3 + i * 3.1)))
    const r0 = RIM_R + 4 + 10 * burst
    const r1 = r0 + len * (0.3 + 0.7 * burst)
    return {
      x1: HOOP.x + Math.cos(angle) * r0,
      y1: HOOP.y + Math.sin(angle) * r0,
      x2: HOOP.x + Math.cos(angle) * r1,
      y2: HOOP.y + Math.sin(angle) * r1,
    }
  })

  // Miss: the carom kicks radially off whichever part of the iron the ball hit
  // (end varies per possession — front rim, side rim…), with a touch of spin
  // and a small parabolic hop, decelerating as it dies. Clamped to the floor.
  const bounceT = 1 - (1 - fadeT) ** 2
  const out = Math.atan2(end.y - HOOP.y, end.x - HOOP.x)
  const caromDir = out + (kick - 0.5) * 1.1
  const caromDist = (20 + kick * 16) * bounceT
  const caromX = Math.max(8, Math.min(COURT_W - 8, end.x + Math.cos(caromDir) * caromDist))
  const caromY =
    Math.max(8, Math.min(COURT_H - 8, end.y + Math.sin(caromDir) * caromDist)) -
    10 * 4 * bounceT * (1 - bounceT)

  return (
    <g style={{ pointerEvents: "none" }}>
      {/* The trace scales WITH the court (no non-scaling-stroke): it's the
          star of the animation, not a hairline of the diagram, so it should
          read clearly at the rendered size. */}
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={1.8}
        strokeDasharray={made ? undefined : "5 4"}
        strokeLinecap="round"
        opacity={traceOpacity}
      />
      {arcT < 1 && (
        <circle cx={head.x} cy={head.y} r={BALL_R} fill={color} opacity={1 - fadeT} />
      )}
      {made && arcT >= 1 && (
        <>
          {/* The ball falls through the hoop — from a bird's eye it shrinks away. */}
          <circle
            cx={HOOP.x}
            cy={HOOP.y}
            r={BALL_R * Math.max(0, 1 - fadeT / 0.35)}
            fill={color}
          />
          {/* Rim flash + one ink ripple rolling outward. */}
          <circle
            cx={HOOP.x}
            cy={HOOP.y}
            r={RIM_R}
            fill="none"
            stroke={color}
            strokeWidth={2.4}
            opacity={0.9 * (1 - fadeT)}
          />
          <circle
            cx={HOOP.x}
            cy={HOOP.y}
            r={RIM_R + 22 * burst}
            fill="none"
            stroke={color}
            strokeWidth={1.2}
            vectorEffect="non-scaling-stroke"
            opacity={0.5 * (1 - fadeT)}
          />
          {/* The action-tick burst around the iron. */}
          {ticks.map((tick, i) => (
            <line
              key={i}
              x1={tick.x1}
              y1={tick.y1}
              x2={tick.x2}
              y2={tick.y2}
              stroke={color}
              strokeWidth={1.4}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              opacity={0.85 * (1 - fadeT)}
            />
          ))}
        </>
      )}
      {!made && arcT >= 1 && (
        <circle cx={caromX} cy={caromY} r={BALL_R} fill={color} opacity={1 - fadeT} />
      )}
    </g>
  )
}

// A hand-drawn whistle (lucide has none): a round chamber with a left mouthpiece
// tube and a top air vent, drawn white with the chamber bore punched back to the
// disc color so the silhouette reads even at ~12px. `bg` is the disc color.
function WhistleIcon({
  x,
  y,
  size,
  bg,
}: {
  x: number
  y: number
  size: number
  bg: string
}) {
  return (
    <svg x={x} y={y} width={size} height={size} viewBox="0 0 24 24">
      <rect x="2" y="8.5" width="9" height="5" rx="2" fill="var(--primary-foreground)" />
      <rect x="12" y="3.6" width="3" height="3.6" rx="1.5" fill="var(--primary-foreground)" />
      <circle cx="13.5" cy="13" r="7.5" fill="var(--primary-foreground)" />
      <circle cx="13.5" cy="13" r="3.1" fill={bg} />
    </svg>
  )
}

// The icon-in-a-disc itself: a filled player-colour coin carrying the whistle
// (foul) or lucide Grab (steal) in the on-accent ink. Shared by the persistent
// floor mark and the live pop, so the two always look identical. `pop` drops it
// in with a squash (the newest event during live playback).
function EventGlyph({
  kind,
  cx,
  cy,
  r,
  color,
  pop,
}: {
  kind: LiveEventKind
  cx: number
  cy: number
  r: number
  color: string
  pop?: boolean
}) {
  // Pad the icon well inside the disc so it never overflows the rim. The line-art
  // Grab fills its viewBox to the corners, so it needs more padding than the
  // custom (tighter) whistle.
  const size = r * (kind === "foul" ? 1.55 : 1.25)
  return (
    <g style={{ pointerEvents: "none" }} className={cn(pop && "animate-dot-drop")}>
      <circle cx={cx} cy={cy} r={r} fill={color} />
      {kind === "foul" ? (
        <WhistleIcon x={cx - size / 2} y={cy - size / 2} size={size} bg={color} />
      ) : (
        <Grab x={cx - size / 2} y={cy - size / 2} width={size} height={size} color="var(--primary-foreground)" strokeWidth={2.2} />
      )}
    </g>
  )
}

// The live flourish for a non-shot possession — fired by the clock while the
// event happens (see activeEventAt). A FOUL blows the whistle: the whistle disc
// swells and shakes (drawn on top of the resting glyph it matches), with a
// couple of faint air-rings puffing off it. A STEAL pops the ball loose: it
// bounces away from the ball-handler and rolls out, fading. `t` is 0..1 across
// the flourish; everything derives from it, so a scrub back replays it exactly.
// In the player's colour.
function EventFx({
  kind,
  x,
  y,
  color,
  t,
}: {
  kind: LiveEventKind
  x: number
  y: number
  color: string
  t: number
}) {
  const s = eventSwell(t)
  if (kind === "foul") {
    // Wobble: the whistle ROTATES back and forth a few degrees, decaying — it
    // reads as the whistle being blown, not sliding around.
    const rot = Math.sin(t * 17) * 12 * (1 - t)
    return (
      <g style={{ pointerEvents: "none" }}>
        {[0, 1, 2].map((i) => {
          // An unhurried pulse: each ring expands across most of the window,
          // staggered, so the rings read as a slow ripple rather than a blip.
          const tt = clamp01((t - i * 0.18) / 0.8)
          if (tt <= 0 || tt >= 1) return null
          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={DOT_R + 2 + tt * 22}
              fill="none"
              stroke={color}
              strokeWidth={1.4 * (1 - tt)}
              vectorEffect="non-scaling-stroke"
              opacity={0.45 * (1 - tt)}
            />
          )
        })}
        {/* Spin the whistle in place, then swell it about its centre. */}
        <g transform={`rotate(${rot} ${x} ${y}) ${scaleAbout(x, y, s)}`}>
          <EventGlyph kind="foul" cx={x} cy={y} r={DOT_R} color={color} />
        </g>
      </g>
    )
  }

  // Steal: the hand glyph gives the same quick swell as the whistle, while the
  // ball pops loose and bounces away from the ball-handler, hopping with decaying
  // height and fading as it rolls out.
  const roll = clamp01(t)
  const ballX = x + 34 * roll
  const ballY = y - Math.abs(Math.sin(roll * Math.PI * 2.4)) * 10 * (1 - roll)
  const op = 1 - clamp01((roll - 0.65) / 0.35)
  return (
    <g style={{ pointerEvents: "none" }}>
      {roll > 0 && roll < 1 && (
        <circle cx={ballX} cy={ballY} r={DOT_R * 0.6} fill={color} opacity={op} />
      )}
      <g transform={scaleAbout(x, y, s)}>
        <EventGlyph kind="turnover" cx={x} cy={y} r={DOT_R} color={color} />
      </g>
    </g>
  )
}

// The pre-tip countdown: the two names framed over the court with a punchy
// 3-2-1. The number is keyed by `count` so each tick re-fires its pop. Purely
// decorative (the game is paused beneath it), so it's hidden from a11y.
function CountdownOverlay({
  nameA,
  nameB,
  colorA,
  colorB,
  count,
}: {
  nameA: string
  nameB: string
  colorA: string
  colorB: string
  count: number
}) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 rounded-sm bg-background/85"
    >
      <div className="flex items-center gap-3 sm:gap-4">
        <span className="display text-2xl sm:text-4xl" style={{ color: colorA }}>
          {lastName(nameA)}
        </span>
        <span className="font-display text-lg font-black italic text-muted-foreground sm:text-2xl">
          vs.
        </span>
        <span className="display text-2xl sm:text-4xl" style={{ color: colorB }}>
          {lastName(nameB)}
        </span>
      </div>
      <span
        key={count}
        className="countdown-pop stat-figure text-7xl leading-none tabular-nums text-foreground sm:text-8xl"
      >
        {count}
      </span>
    </div>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="size-2 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  )
}

function ShotTooltip({ play, color, at }: { play: PlayByPlay; color: string; at: { x: number; y: number } }) {
  const { x, y } = at
  const shot = isShot(play)
  const made = play.result === "made"
  const left = Math.min(82, Math.max(18, pct(x, COURT_W)))
  const above = y > COURT_H / 2
  return (
    <div
      className="pointer-events-none absolute z-20 w-max max-w-[70%] -translate-x-1/2 rounded-sm border border-border bg-background/95 px-2.5 py-1.5 shadow-sm"
      style={{ left: `${left}%`, top: `${pct(y, COURT_H)}%`, transform: `translate(-50%, ${above ? "calc(-100% - 10px)" : "10px"})` }}
    >
      <div className="flex items-center gap-1.5">
        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <span className="truncate display text-sm leading-none">{play.offensive_player}</span>
      </div>
      <div className="mt-1 flex items-center gap-2 kicker text-muted-foreground">
        <span className="capitalize">{shotDescriptor(play)}</span>
        {shot && (
          <span className={cn(made ? "text-primary" : "text-muted-foreground")}>{made ? `Make · +${pointsForPlay(play)}` : "Miss"}</span>
        )}
      </div>
      <div className="mt-0.5 kicker tabular-nums text-muted-foreground/80">
        {play.score_a}–{play.score_b} · Poss {play.possession}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Transport                                                                  */
/* -------------------------------------------------------------------------- */

function Transport({ live }: { live: Live }) {
  return (
    // A proper deck for the playback controls — flat hairline card, like every
    // other panel on the page, instead of controls floating loose on the paper.
    <div className="flex items-center gap-2 rounded-sm border bg-card px-3 py-2 sm:gap-3">
      <Button variant="default" size="icon" onClick={live.togglePlay} aria-label={live.playing ? "Pause" : "Play"} className="size-8 shrink-0">
        {live.playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </Button>
      <Button variant="outline" size="icon" onClick={live.restart} aria-label="Restart" className="hidden size-8 shrink-0 sm:inline-flex">
        <RotateCcw className="h-4 w-4" />
      </Button>
      {/* Fixed-width clock: the readout's digit count changes as time rolls
          (0:09 → 0:10 → 10:00), and a self-sizing label kept resizing the
          flex row, making the scrub bar flicker. The box is sized to the
          widest possible reading so the bar's width never moves. */}
      <span className="hidden w-[7.25rem] shrink-0 justify-center font-display text-sm font-bold tabular-nums text-muted-foreground sm:inline-flex">
        {formatClock(live.clockSeconds)} / {formatClock(live.totalSeconds)}
      </span>
      <input
        type="range"
        min={0}
        max={Math.max(1, Math.round(live.totalSeconds))}
        value={Math.round(live.clockSeconds)}
        onChange={(event) => live.seek(Number(event.target.value))}
        aria-label="Scrub game"
        className="h-1.5 flex-1 cursor-pointer accent-primary"
      />
      {/* Segmented speed control — the site's neutral toggle pattern (active =
          ink fill), so the single vermillion accent stays reserved for the
          primary play button and isn't spent on a speed picker. */}
      <div
        role="group"
        aria-label="Playback speed"
        className="hidden h-8 shrink-0 items-center gap-0.5 rounded-sm border border-border bg-background p-0.5 sm:flex"
      >
        {SPEEDS.map((speed) => (
          <button
            key={speed}
            onClick={() => live.setSpeed(speed)}
            aria-pressed={live.speed === speed}
            className={cn(
              "rounded-[0.15rem] px-2 py-1 font-condensed text-xs font-bold uppercase tracking-[0.1em] tabular-nums transition-colors",
              live.speed === speed
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            {speed}×
          </button>
        ))}
      </div>
      <Button variant="outline" onClick={live.skip} className="h-8 shrink-0 whitespace-nowrap px-3 font-condensed font-bold uppercase tracking-[0.12em]">
        <SkipForward className="h-4 w-4" />
        Skip to end
      </Button>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* The game box — live box while playing, the Game Story when settled         */
/* -------------------------------------------------------------------------- */

const GameBox = memo(function GameBox({
  plays,
  revealedCount,
  nameA,
  nameB,
  colorA,
  colorB,
  finished,
  summary,
  warningsSlot,
}: {
  plays: PlayByPlay[]
  revealedCount: number
  nameA: string
  nameB: string
  colorA: string
  colorB: string
  finished: boolean
  summary: MatchSummary | null
  warningsSlot?: ReactNode
}) {
  const box = useMemo(() => boxScoreThrough(plays, revealedCount), [plays, revealedCount])
  const winnerName = summary
    ? summary.final_score.a >= summary.final_score.b
      ? nameA
      : nameB
    : null
  // A real <table> whose header and body are generated from ONE column spec, so
  // every label sits dead-centre over its figures — there is no way for the two
  // to drift apart (the old hand-written header/body pair could, and did). Each
  // stat column is centre-aligned in a fixed-width cell, with roomy padding so
  // the row reads like a printed box score, not a cramped grid.
  return (
    <div className="shrink-0 overflow-hidden rounded-sm border">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b bg-muted/30">
            <th scope="col" className="w-full px-3 py-2 text-left font-normal">
              <span className="flex items-center gap-1.5 kicker text-muted-foreground">
                {finished ? "The Game Story" : "Live Box Score"}
                {finished && warningsSlot}
              </span>
            </th>
            {/* The kicker class sets display:inline-flex, which would strip the
                <th> of its table-cell display and collapse the column layout —
                so it lives on an inner <span>, never the cell itself. */}
            {BOX_COLUMNS.map((c) => (
              <th
                key={c.label}
                scope="col"
                className={cn("min-w-[3rem] px-2 py-2 text-center align-middle", c.hideClass)}
              >
                <span className="kicker text-muted-foreground">{c.label}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <BoxRow name={nameA} color={colorA} line={box[nameA] ?? emptyStatLine()} winner={winnerName === nameA} />
          <BoxRow name={nameB} color={colorB} line={box[nameB] ?? emptyStatLine()} winner={winnerName === nameB} />
        </tbody>
      </table>
    </div>
  )
})

// The single source of truth for the box-score columns: label + how to read the
// figure off a stat line + which (if any) breakpoint hides it. Header and body
// both map over this, so they can never disagree.
const BOX_COLUMNS: {
  label: string
  get: (line: LiveStatLine) => string | number
  hideClass?: string
  accent?: boolean
}[] = [
  { label: "PTS", get: (l) => l.points, accent: true },
  { label: "FG", get: (l) => `${l.fgm}/${l.fga}` },
  { label: "3PT", get: (l) => `${l.threePm}/${l.threePa}` },
  { label: "Rim", get: (l) => `${l.rimMade}/${l.rimAtt}`, hideClass: "hidden sm:table-cell" },
  { label: "Mid", get: (l) => `${l.midMade}/${l.midAtt}`, hideClass: "hidden sm:table-cell" },
  { label: "TO", get: (l) => l.turnovers },
  { label: "FD", get: (l) => l.foulsDrawn },
]

function BoxRow({
  name,
  color,
  line,
  winner,
}: {
  name: string
  color: string
  line: LiveStatLine
  winner: boolean
}) {
  return (
    <tr className={cn(winner && "bg-primary/5")}>
      <td className="px-3 py-2.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
          <span className={cn("truncate display text-sm leading-none", winner && "text-primary")}>{name}</span>
          {winner && <span className="shrink-0 kicker leading-none text-primary">Winner</span>}
        </span>
      </td>
      {BOX_COLUMNS.map((c) => (
        <td
          key={c.label}
          className={cn(
            "min-w-[3rem] px-2 py-2.5 text-center font-display text-sm font-bold tabular-nums",
            c.hideClass
          )}
          style={c.accent ? { color } : undefined}
        >
          {c.get(line)}
        </td>
      ))}
    </tr>
  )
}

/* -------------------------------------------------------------------------- */
/* Win probability (this game)                                                */
/* -------------------------------------------------------------------------- */

function OddsGraph({
  enriched,
  timings,
  revealedCount,
  finished,
  nameA,
  nameB,
  colorA,
  colorB,
  reduced,
  winProb,
  onJump,
}: {
  enriched: EnrichedPlay[]
  timings: { start: number; duration: number }[]
  revealedCount: number
  finished: boolean
  nameA: string
  nameB: string
  colorA: string
  colorB: string
  reduced: boolean
  winProb: number[]
  onJump: (seconds: number) => void
}) {
  // The model's win-probability curve (from the backend); falls back to a flat
  // 50% only if an older backend didn't supply it.
  const series = winProb.length === enriched.length ? winProb : enriched.map(() => 0.5)
  const shownCount = finished ? series.length : revealedCount
  const W = 600
  const H = 92
  const mid = H / 2
  const n = shownCount
  const [hover, setHover] = useState<number | null>(null)
  const xOf = (i: number) => (n <= 1 ? W / 2 : (i / (n - 1)) * W)
  const yOf = (p: number) => (1 - p) * (H - 12) + 6
  const pts = series.slice(0, shownCount)
  const line = pts.map((p, i) => `${xOf(i)},${yOf(p)}`).join(" ")
  const area =
    n > 0
      ? `M ${xOf(0)},${mid} ` + pts.map((p, i) => `L ${xOf(i)},${yOf(p)}`).join(" ") + ` L ${xOf(n - 1)},${mid} Z`
      : ""
  const hoverP = hover != null ? pts[hover] : null
  const hoverEntry = hover != null ? enriched[hover] : null
  const liveP = pts.length ? pts[pts.length - 1] : 0.5
  const shownP = hoverP ?? liveP
  const favorsA = shownP >= 0.5
  const raw = favorsA ? shownP : 1 - shownP
  // Only show 100% once it's truly decided (a player reached 21); otherwise a
  // comeback is always possible, so cap the readout at 99%.
  const favPct = raw >= 1 ? 100 : Math.min(99, Math.max(1, Math.round(raw * 100)))

  const onMove = (event: React.MouseEvent<SVGSVGElement>) => {
    if (n === 0) return
    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = (event.clientX - rect.left) / rect.width
    setHover(Math.max(0, Math.min(n - 1, Math.round(ratio * (n - 1)))))
  }

  return (
    <div className="p-3">
      <div className="mb-1.5 flex items-center justify-between">
        {/* "Win Probability", not "The Odds" — that name belongs to the
            1,000-simulation verdict; this curve is this one game only. */}
        <Kicker tone="muted">Win Probability</Kicker>
        <span className="kicker tabular-nums">
          <span style={{ color: favorsA ? colorA : colorB }}>
            {lastName(favorsA ? nameA : nameB)} {favPct}%
          </span>
          {hoverEntry && <span className="text-muted-foreground"> · {hoverEntry.play.score_a}–{hoverEntry.play.score_b}</span>}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className={cn("h-16 w-full", finished && "cursor-pointer")}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        onClick={() => {
          if (finished && hover != null) onJump((timings[hover]?.start ?? 0) + 0.001)
        }}
      >
        <defs>
          <clipPath id="odds-top">
            <rect x="0" y="0" width={W} height={mid} />
          </clipPath>
          <clipPath id="odds-bottom">
            <rect x="0" y={mid} width={W} height={mid} />
          </clipPath>
        </defs>
        {area && (
          <>
            <path d={area} clipPath="url(#odds-top)" style={{ fill: colorA, opacity: 0.18 }} />
            <path d={area} clipPath="url(#odds-bottom)" style={{ fill: colorB, opacity: 0.18 }} />
          </>
        )}
        <line x1="0" y1={mid} x2={W} y2={mid} className="stroke-border" strokeDasharray="3 4" />
        {n > 0 && (
          <polyline points={line} fill="none" className="stroke-foreground/70" strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        )}
        {!reduced &&
          enriched.slice(0, shownCount).map((e, i) => (e.leadChange ? <circle key={i} cx={xOf(i)} cy={yOf(pts[i])} r={2.5} className="fill-primary" /> : null))}
        {hover != null && <line x1={xOf(hover)} y1={0} x2={xOf(hover)} y2={H} className="stroke-foreground/40" vectorEffect="non-scaling-stroke" />}
      </svg>
      <div className="mt-1 kicker text-muted-foreground/70">
        {finished
          ? "The model's race-to-21 read, recomputed every possession — click the curve to replay from there"
          : "The model's race-to-21 read, recomputed every possession"}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Play-by-play (the wire)                                                    */
/* -------------------------------------------------------------------------- */

const WireFeed = memo(function WireFeed({
  enriched,
  timings,
  revealedCount,
  currentPossession,
  nameA,
  colorA,
  colorB,
  reduced,
  finished,
  seek,
  footer,
}: {
  enriched: EnrichedPlay[]
  timings: { start: number; duration: number }[]
  revealedCount: number
  currentPossession: number | null
  nameA: string
  colorA: string
  colorB: string
  reduced: boolean
  finished: boolean
  seek: (seconds: number) => void
  footer: ReactNode
}) {
  const listRef = useRef<HTMLUListElement>(null)
  // Scroll ONLY the list to keep the current row visible — never scrollIntoView,
  // which walks up to the document and would jump the whole page.
  useEffect(() => {
    if (finished) return
    const list = listRef.current
    const node = list?.querySelector<HTMLElement>('[data-current="true"]')
    if (!list || !node) return
    const nodeTop = node.offsetTop
    const nodeBottom = nodeTop + node.offsetHeight
    const viewTop = list.scrollTop
    const viewBottom = viewTop + list.clientHeight
    if (nodeBottom > viewBottom) {
      list.scrollTo({ top: nodeBottom - list.clientHeight, behavior: reduced ? "auto" : "smooth" })
    } else if (nodeTop < viewTop) {
      list.scrollTo({ top: nodeTop, behavior: reduced ? "auto" : "smooth" })
    }
  }, [currentPossession, reduced, finished])

  const rows = finished ? enriched : enriched.slice(0, revealedCount)

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden rounded-sm border">
      <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
        <Kicker tone="muted">The Play-by-Play</Kicker>
        <span className="kicker tabular-nums text-muted-foreground">{finished ? enriched.length : revealedCount}/{enriched.length}</span>
      </div>
      <ul ref={listRef} className="scrollbar-hide min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {rows.map((entry, index) => (
          <WireRow
            key={entry.play.possession}
            entry={entry}
            nameA={nameA}
            colorA={colorA}
            colorB={colorB}
            current={!finished && entry.play.possession === currentPossession}
            reduced={reduced}
            clock={formatClock(timings[index]?.start ?? 0)}
            onClick={() => seek((timings[index]?.start ?? 0) + 0.001)}
          />
        ))}
        {rows.length === 0 && (
          <li className="px-3 py-3 kicker text-muted-foreground">Tip-off…</li>
        )}
      </ul>
      <div className="shrink-0 border-t">{footer}</div>
    </div>
  )
})

function WireRow({
  entry,
  nameA,
  colorA,
  colorB,
  current,
  reduced,
  clock,
  onClick,
}: {
  entry: EnrichedPlay
  nameA: string
  colorA: string
  colorB: string
  current: boolean
  reduced: boolean
  clock: string
  onClick: () => void
}) {
  const play = entry.play
  const isA = play.offensive_player === nameA
  const color = isA ? colorA : colorB
  const made = play.result === "made"
  const points = pointsForPlay(play)
  const outcome = play.turnover ? "TO" : play.foul ? "Foul" : made ? `+${points}` : "Miss"
  return (
    <li className={cn(!reduced && "animate-wire-in")} data-current={current || undefined}>
      <button
        onClick={onClick}
        aria-label={`Jump to possession ${play.possession}`}
        className={cn("flex w-full items-center gap-2 border-b border-border/50 px-3 py-1.5 text-left transition-colors hover:bg-muted/50", current && "bg-muted")}
        style={{ boxShadow: `inset 3px 0 0 0 ${current ? color : `color-mix(in srgb, ${color} 20%, transparent)`}` }}
      >
        <span className="w-9 shrink-0 font-display text-xs font-bold tabular-nums text-muted-foreground">{clock}</span>
        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <span className="min-w-0 flex-1 truncate font-condensed text-xs font-bold uppercase tracking-[0.06em]">
          {lastName(play.offensive_player)}
          <span className="ml-1.5 font-normal capitalize tracking-normal text-muted-foreground">{shotDescriptor(play)}</span>
        </span>
        {entry.runCallout != null && <span className="shrink-0 kicker tabular-nums text-primary">{entry.runCallout}-0</span>}
        <span className={cn("w-10 shrink-0 text-right font-display text-xs font-bold tabular-nums", made ? "text-primary" : "text-muted-foreground")}>{outcome}</span>
        <span className="hidden w-12 shrink-0 text-right font-display text-xs font-bold tabular-nums text-muted-foreground sm:block">{play.score_a}–{play.score_b}</span>
      </button>
    </li>
  )
}

/* -------------------------------------------------------------------------- */
/* Controls + helpers                                                         */
/* -------------------------------------------------------------------------- */

function FilterToggle({
  value,
  onChange,
  nameA,
  nameB,
}: {
  value: "a" | "b" | null
  onChange: (value: "a" | "b" | null) => void
  nameA: string
  nameB: string
}) {
  const options: { key: "a" | "b" | null; label: string }[] = [
    { key: null, label: "Both" },
    { key: "a", label: lastName(nameA) },
    { key: "b", label: lastName(nameB) },
  ]
  return (
    <div className="flex items-center gap-0.5 rounded-sm border p-0.5">
      {options.map((option) => (
        <button
          key={String(option.key)}
          onClick={() => onChange(option.key)}
          aria-pressed={value === option.key}
          className={cn(
            "rounded-[0.15rem] px-2 py-1 font-condensed text-[0.7rem] font-bold uppercase tracking-[0.08em] transition-colors",
            value === option.key ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("")
}

function lastName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return parts[parts.length - 1] ?? name
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return
    const query = window.matchMedia("(prefers-reduced-motion: reduce)")
    setReduced(query.matches)
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches)
    query.addEventListener("change", onChange)
    return () => query.removeEventListener("change", onChange)
  }, [])
  return reduced
}
