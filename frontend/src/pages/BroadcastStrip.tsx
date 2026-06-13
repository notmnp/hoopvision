import {
  type ReactNode,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { Gauge, Grab, Pause, Play, RotateCcw, SkipForward, Zap } from "lucide-react"

import { cn } from "@/lib/utils"
import { HalftoneAvatar, Kicker } from "@/components/editorial"
import { Button } from "@/components/ui/button"
import {
  COURT_VIEWBOX,
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
  activeShotAt,
  boxScoreThrough,
  emptyStatLine,
  enrichPlays,
  type EnrichedPlay,
  formatClock,
  type LiveStatLine,
  pointsForPlay,
  resolveSides,
  shotDescriptor,
  type ZoneSplit,
  zoneFgPct,
  zoneSplitsThrough,
} from "@/lib/liveGame"
import { formatPct, gradeZone, hexToRgb } from "@/lib/shotEfficiency"
import { useLiveGame, type PlaybackSpeed } from "@/hooks/useLiveGame"
import { PlayByPlay, SimulationResult } from "@/lib/simulation"

const SPEEDS: PlaybackSpeed[] = [1, 2, 4, 8]
const AUTOSKIP_KEY = "hooper.autoSkip"
const VERMILLION = "#d2401f"
// The shot line is colored by its eventual outcome so the result reads from the
// trajectory itself: orange when it's going in, red when it's going to miss.
const SHOT_ORANGE = "#e0852f" // a make — also the net's brief orange flash
const SHOT_RED = "#e23b2e" // a miss — the net does not change
const SLATE = "#3f6fa3"
// Non-shot possession chips: amber for a drawn foul (a caution, not a card),
// vermillion-red for a turnover/steal (a strip).
const FOUL_AMBER = "#d99a2b"
const STEAL_RED = VERMILLION

type Live = ReturnType<typeof useLiveGame>

interface LivePlayer {
  player_id: number
  name: string
}

// An inline, single-screen broadcast of an already-computed 1v1 game: court +
// scoreboard on the left, the play-by-play + a live win-probability ("Odds")
// graph on the right, transport across the bottom — all bounded to roughly one
// viewport so the growing play-by-play never scrolls the page. The court keeps
// its angled broadcast-camera tilt throughout (so the shot arc reads); at the
// final whistle it becomes a two-player shot-chart comparison with a
// zone-efficiency heat map.
export default function BroadcastStrip({
  result,
  playerA,
  playerB,
  accentA,
  accentB,
  billing,
}: {
  result: SimulationResult
  playerA: LivePlayer
  playerB: LivePlayer
  accentA?: string | null
  accentB?: string | null
  billing?: string | null
}) {
  const plays = result.play_by_play
  const reduced = usePrefersReducedMotion()
  const [autoSkip, setAutoSkip] = usePersistentToggle(AUTOSKIP_KEY)
  const effectiveReduced = reduced || autoSkip

  // Autoplay is held off until the on-court 3-2-1 countdown completes.
  const live = useLiveGame(plays, false, 0)
  const finished = live.finished

  // A quick 3-2-1 countdown shown on the court before tip-off (this replaces the
  // old full-screen name-vs-name overlay). The game stays paused until it hits
  // zero, then playback begins. Skipped for reduced-motion / auto-skip viewers,
  // who jump straight into the game.
  const [countdown, setCountdown] = useState(() => {
    if (typeof window === "undefined" || autoSkip) return 0
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : 3
  })
  const countingDown = countdown > 0
  useEffect(() => {
    if (countdown <= 0) {
      live.play()
      return
    }
    const timer = window.setTimeout(() => setCountdown((c) => c - 1), 650)
    return () => window.clearTimeout(timer)
    // live.play is stable for a given game; re-run only on each countdown tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown])

  const { nameA, nameB } = useMemo(
    () => resolveSides(plays, playerA.name, playerB.name),
    [plays, playerA.name, playerB.name]
  )
  const { colorA, colorB } = useMemo(
    () => resolvePalette(accentA, accentB),
    [accentA, accentB]
  )
  const enriched = useMemo(() => enrichPlays(plays, nameA), [plays, nameA])

  const current = live.revealedCount > 0 ? plays[live.revealedCount - 1] : null
  const scoreA = current ? current.score_a : 0
  const scoreB = current ? current.score_b : 0
  const possessionSide: "a" | "b" | null = current
    ? current.offensive_player === nameA
      ? "a"
      : "b"
    : null

  const [filter, setFilter] = useState<"a" | "b" | null>(null)
  const jump = (seconds: number) => {
    live.seek(seconds)
    live.play()
  }
  const replay = () => {
    setFilter(null)
    live.seek(0)
    live.play()
  }

  const footer = finished ? (
    <ShootingSplits plays={plays} nameA={nameA} nameB={nameB} colorA={colorA} colorB={colorB} />
  ) : (
    <OddsGraph
      enriched={enriched}
      timings={live.timings}
      revealedCount={live.revealedCount}
      finished={finished}
      nameA={nameA}
      nameB={nameB}
      colorA={colorA}
      colorB={colorB}
      reduced={reduced}
      winProb={result.win_probability ?? []}
      onJump={jump}
    />
  )

  return (
    <section
      className={cn(
        "mt-6 flex min-h-[calc(100svh-5rem)] flex-col gap-3",
        "lg:grid lg:h-[calc(100svh-5rem)] lg:min-h-[600px] lg:max-h-[940px] lg:grid-rows-[auto_minmax(0,1fr)_auto] lg:gap-3"
      )}
    >
      {/* Scoreboard */}
      <div className="rounded-sm border border-border bg-card/70 px-3 py-2.5 backdrop-blur">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-4">
          <TeamPlate player={playerA} score={scoreA} color={colorA} leading={scoreA > scoreB} hasBall={possessionSide === "a"} align="right" reduced={effectiveReduced} />
          <CenterColumn clockSeconds={live.clockSeconds} finished={finished} billing={billing} reduced={reduced} />
          <TeamPlate player={playerB} score={scoreB} color={colorB} leading={scoreB > scoreA} hasBall={possessionSide === "b"} align="left" reduced={effectiveReduced} />
        </div>
      </div>

      {/* Body: court (left) + play-by-play (right) */}
      <div className="grid min-h-0 gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(300px,1fr)]">
        {/* Left column */}
        <div className="flex min-h-0 flex-col gap-2">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <div className="flex items-center gap-3 font-condensed text-[0.7rem] font-bold uppercase tracking-[0.1em] text-muted-foreground">
              <Kicker tone="muted">{finished ? "The Shot Chart" : "The Floor"}</Kicker>
              <LegendDot color={colorA} label={lastName(nameA)} />
              <LegendDot color={colorB} label={lastName(nameB)} />
              <span className="hidden items-center gap-1 sm:flex">
                <span className="size-2 rounded-full border border-muted-foreground/60" />
                open = miss
              </span>
            </div>
            {finished && <FilterToggle value={filter} onChange={setFilter} nameA={nameA} nameB={nameB} />}
          </div>

          <div className="relative flex min-h-0 flex-1 items-center justify-center">
            <FloorStage
              plays={plays}
              revealedCount={live.revealedCount}
              currentPossession={current?.possession ?? null}
              nameA={nameA}
              colorA={colorA}
              colorB={colorB}
              reduced={effectiveReduced}
              showFx={!finished}
              started={!countingDown}
              filterSide={finished ? filter : null}
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
          </div>

          <LiveBox plays={plays} revealedCount={live.revealedCount} nameA={nameA} nameB={nameB} colorA={colorA} colorB={colorB} />
        </div>

        {/* Right column: play-by-play + footer graph/splits */}
        <WireFeed
          enriched={enriched}
          timings={live.timings}
          revealedCount={live.revealedCount}
          currentPossession={current?.possession ?? null}
          nameA={nameA}
          colorA={colorA}
          colorB={colorB}
          reduced={effectiveReduced}
          finished={finished}
          seek={jump}
          footer={footer}
        />
      </div>

      {/* Transport */}
      <div className="shrink-0">
        {finished ? (
          <div className="flex items-center justify-center gap-2">
            <Button variant="outline" onClick={replay} className="font-condensed font-bold uppercase tracking-[0.14em]">
              <RotateCcw className="h-4 w-4" />
              Replay from tip
            </Button>
          </div>
        ) : (
          <Transport live={live} autoSkip={autoSkip} onAutoSkip={setAutoSkip} />
        )}
      </div>
    </section>
  )
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
  align,
  reduced,
}: {
  player: LivePlayer
  score: number
  color: string
  leading: boolean
  hasBall: boolean
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
      <div
        className={cn(
          "mt-1 h-0.5 w-8 rounded-full transition-opacity",
          align === "right" ? "ml-auto" : "mr-auto",
          leading ? "opacity-100" : "opacity-30"
        )}
        style={{ backgroundColor: color }}
      />
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
    <div className="flex flex-col items-center gap-0.5 px-1">
      {finished ? (
        <Kicker tone="muted">Final</Kicker>
      ) : (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-court/40 bg-court/10 px-2.5 py-0.5 font-condensed text-[0.7rem] font-bold uppercase tracking-[0.14em] text-court">
          <span className={cn("size-1.5 rounded-full bg-court", !reduced && "animate-pulse")} />
          Live
        </span>
      )}
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

const fracOf = (value: number) => value - Math.floor(value)

// A persistent spot for a non-shot possession (a drawn foul or a steal). These
// have no shot location, so the mark surfaces right inside the ball-handler's
// circle and stays there (hoverable) — a single in-circle indicator, both while
// it happens and afterward. A tiny deterministic offset fans out repeated
// fouls/steals by the same player so they don't stack on one pixel.
function eventSpot(possession: number, side: "a" | "b") {
  const home = PLAYER_HOME[side]
  const a = fracOf(Math.sin((possession + 1) * 91.7))
  const b = fracOf(Math.sin((possession + 1) * 47.3))
  return { x: home.x + (a - 0.5) * 22, y: home.y + (b - 0.5) * 22 }
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
        // Fixed radius — never grow on hover (growing moves the hit ring out
        // from under the cursor and causes the jitter). A separate, larger,
        // invisible hit target makes both makes and the hollow misses easy and
        // stable to acquire.
        const radius = isNewest ? 7.5 : 6
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
            <circle cx={x} cy={y} r={14} fill="transparent" stroke="none" />
            {isNewest && showFx && !reduced && (
              <circle cx={x} cy={y} r={13} fill="none" className="animate-pulse" style={{ stroke: color, pointerEvents: "none" }} strokeWidth={1.5} opacity={0.4} />
            )}
            <circle cx={x} cy={y} r={radius} fill={made ? color : "none"} stroke={made ? "none" : color} strokeWidth={made ? 0 : 2.2} style={{ pointerEvents: "none" }} />
            {isHover && <circle cx={x} cy={y} r={radius + 5} fill="none" style={{ stroke: color, pointerEvents: "none" }} strokeWidth={1.25} opacity={0.6} />}
          </g>
        )
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shots, colorA, colorB, currentPossession, hovered, reduced, showFx, nameA]
  )

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
        const side = sideOf(play)
        const { x, y } = eventSpot(play.possession, side)
        const color = play.turnover ? STEAL_RED : FOUL_AMBER
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
            <circle cx={x} cy={y} r={14} fill="transparent" stroke="none" />
            <EventGlyph kind={play.turnover ? "turnover" : "foul"} cx={x} cy={y} r={8} color={color} />
            {isHover && <circle cx={x} cy={y} r={13} fill="none" style={{ stroke: color, pointerEvents: "none" }} strokeWidth={1.25} opacity={0.6} />}
          </g>
        )
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, hovered, nameA]
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

  return (
    <div className="relative mx-auto aspect-[564/400] w-full max-w-[680px] lg:h-full lg:w-auto lg:max-w-none">
      {/* Only the court (and its tilted plane) is clipped; tooltips live outside
          this box so they're never cut off at the court border. */}
      <div className="court-cam absolute inset-0 overflow-hidden rounded-sm border bg-muted/15">
        <div className="court-floor absolute inset-0">
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

              {/* The shot projectile: a thin trace + ball head, colored by outcome
                  (orange make / red miss); a make briefly lights the net orange. */}
              {shot && <ShotFx shot={shot} />}
            </>
          )}
          </svg>
        </div>
        <span aria-hidden className="halftone halftone-fade pointer-events-none absolute inset-0 opacity-20" />
      </div>

      {hoveredPlay && (
        <ShotTooltip
          play={hoveredPlay}
          color={sideOf(hoveredPlay) === "a" ? colorA : colorB}
          at={
            isEvent(hoveredPlay)
              ? eventSpot(hoveredPlay.possession, sideOf(hoveredPlay))
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
  const left = Math.min(82, Math.max(18, pct(pos.x, 564)))
  const above = pos.y > 200
  return (
    <div
      className="pointer-events-none absolute z-20 w-max max-w-[70%] -translate-x-1/2 rounded-sm border border-border bg-background/95 px-2.5 py-1.5 shadow-md"
      style={{ left: `${left}%`, top: `${pct(pos.y, 400)}%`, transform: `translate(-50%, ${above ? "calc(-100% - 10px)" : "10px"})` }}
    >
      <div className="flex items-center gap-1.5">
        <span className="size-2 shrink-0 rounded-sm" style={{ backgroundColor: grade.stroke }} />
        <span className="truncate display text-sm leading-none">{basic} · {area}</span>
      </div>
      <div className="mt-1 flex items-center gap-2 font-condensed text-[0.68rem] font-bold uppercase tracking-[0.1em] text-muted-foreground tabular-nums">
        <span>{split.made}/{split.att} FG</span>
        <span className="text-foreground">{formatPct(fg)}</span>
      </div>
    </div>
  )
}

function ShotFx({ shot }: { shot: ActiveShot }) {
  const { launch, control, end, made, arcT, fadeT } = shot
  // Color the whole shot line by its outcome — orange on the way to a make,
  // red on the way to a miss — so the result reads straight off the arc.
  const traceColor = made ? SHOT_ORANGE : SHOT_RED
  // The trace: sample the arc from the launch up to the current flight progress.
  const steps = 18
  const maxT = Math.max(arcT, 0.001)
  let d = ""
  for (let s = 0; s <= steps; s++) {
    const p = quadAt(launch, control, end, (s / steps) * maxT)
    d += `${s === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)} `
  }
  const head = quadAt(launch, control, end, arcT)
  const traceOpacity = 0.9 * (1 - fadeT)
  return (
    <g style={{ pointerEvents: "none" }}>
      <path
        d={d}
        fill="none"
        stroke={traceColor}
        strokeWidth={1.4}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        opacity={traceOpacity}
      />
      {arcT < 1 && <circle cx={head.x} cy={head.y} r={3.2} fill={traceColor} opacity={1 - fadeT} />}
      {/* A make lights the net orange through the brief fade window (~0.5s at 1x),
          then it settles back to the floor color; a miss leaves the net untouched.
          No ripple. */}
      {made && fadeT > 0 && (
        <circle
          cx={HOOP.x}
          cy={HOOP.y}
          r={RIM_R}
          fill={SHOT_ORANGE}
          opacity={0.9 * (1 - fadeT)}
        />
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
      <rect x="2" y="8.5" width="9" height="5" rx="2" fill="#fff" />
      <rect x="12" y="3.6" width="3" height="3.6" rx="1.5" fill="#fff" />
      <circle cx="13.5" cy="13" r="7.5" fill="#fff" />
      <circle cx="13.5" cy="13" r="3.1" fill={bg} />
    </svg>
  )
}

// The icon-in-a-disc itself: a filled, white-ringed coin carrying the whistle
// (foul) or lucide Grab (steal). Shared by the persistent floor mark and the
// live pop, so the two always look identical.
function EventGlyph({
  kind,
  cx,
  cy,
  r,
  color,
}: {
  kind: LiveEventKind
  cx: number
  cy: number
  r: number
  color: string
}) {
  // Pad the icon well inside the disc so it never overflows the rim. The line-art
  // Grab fills its viewBox to the corners, so it needs more padding than the
  // custom (tighter) whistle.
  const size = r * (kind === "foul" ? 1.55 : 1.25)
  return (
    <g style={{ pointerEvents: "none" }}>
      <circle cx={cx} cy={cy} r={r} fill={color} stroke="#fff" strokeWidth={1.3} />
      {kind === "foul" ? (
        <WhistleIcon x={cx - size / 2} y={cy - size / 2} size={size} bg={color} />
      ) : (
        <Grab x={cx - size / 2} y={cy - size / 2} width={size} height={size} color="#fff" strokeWidth={2.4} />
      )}
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
      className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 rounded-sm bg-background/70 backdrop-blur-sm"
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
  const left = Math.min(82, Math.max(18, pct(x, 564)))
  const above = y > 200
  return (
    <div
      className="pointer-events-none absolute z-20 w-max max-w-[70%] -translate-x-1/2 rounded-sm border border-border bg-background/95 px-2.5 py-1.5 shadow-md"
      style={{ left: `${left}%`, top: `${pct(y, 400)}%`, transform: `translate(-50%, ${above ? "calc(-100% - 10px)" : "10px"})` }}
    >
      <div className="flex items-center gap-1.5">
        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <span className="truncate display text-sm leading-none">{play.offensive_player}</span>
      </div>
      <div className="mt-1 flex items-center gap-2 font-condensed text-[0.68rem] font-bold uppercase tracking-[0.1em] text-muted-foreground">
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

function Transport({ live, autoSkip, onAutoSkip }: { live: Live; autoSkip: boolean; onAutoSkip: (value: boolean) => void }) {
  return (
    <div className="flex items-center gap-2 sm:gap-3">
      <Button variant="default" size="icon" onClick={live.togglePlay} aria-label={live.playing ? "Pause" : "Play"} className="shrink-0">
        {live.playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </Button>
      <Button variant="outline" size="icon" onClick={live.restart} aria-label="Restart" className="hidden shrink-0 sm:inline-flex">
        <RotateCcw className="h-4 w-4" />
      </Button>
      <span className="hidden shrink-0 font-display text-sm font-bold tabular-nums text-muted-foreground sm:block">
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
      <div className="hidden shrink-0 items-center gap-0.5 rounded-sm border p-0.5 sm:flex">
        {SPEEDS.map((speed) => (
          <button
            key={speed}
            onClick={() => live.setSpeed(speed)}
            aria-pressed={live.speed === speed}
            className={cn(
              "rounded-[0.15rem] px-2 py-1 font-condensed text-xs font-bold uppercase tracking-[0.1em] tabular-nums transition-colors",
              live.speed === speed ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {speed}×
          </button>
        ))}
      </div>
      <button
        onClick={() => onAutoSkip(!autoSkip)}
        aria-pressed={autoSkip}
        title="Skip the per-shot animations, keep the play-by-play"
        className={cn(
          "hidden shrink-0 items-center gap-1.5 rounded-sm border px-2.5 py-1.5 font-condensed text-xs font-bold uppercase tracking-[0.1em] transition-colors sm:inline-flex",
          autoSkip ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
        )}
      >
        {autoSkip ? <Zap className="h-3.5 w-3.5" /> : <Gauge className="h-3.5 w-3.5" />}
        Auto-skip
      </button>
      <Button variant="secondary" onClick={live.skip} className="shrink-0 font-condensed font-bold uppercase tracking-[0.12em]">
        <SkipForward className="h-4 w-4" />
        Skip
      </Button>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Live box                                                                   */
/* -------------------------------------------------------------------------- */

const LiveBox = memo(function LiveBox({
  plays,
  revealedCount,
  nameA,
  nameB,
  colorA,
  colorB,
}: {
  plays: PlayByPlay[]
  revealedCount: number
  nameA: string
  nameB: string
  colorA: string
  colorB: string
}) {
  const box = useMemo(() => boxScoreThrough(plays, revealedCount), [plays, revealedCount])
  return (
    <div className="shrink-0 overflow-hidden rounded-sm border">
      <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-x-3 border-b bg-muted/30 px-3 py-1 font-condensed text-[0.6rem] font-bold uppercase tracking-[0.1em] text-muted-foreground">
        <span>Live Box</span>
        <span className="text-right tabular-nums">PTS</span>
        <span className="text-right tabular-nums">FG</span>
        <span className="text-right tabular-nums">3PT</span>
        <span className="text-right tabular-nums">TO</span>
        <span className="text-right tabular-nums">FD</span>
      </div>
      <BoxRow name={nameA} color={colorA} line={box[nameA] ?? emptyStatLine()} />
      <BoxRow name={nameB} color={colorB} line={box[nameB] ?? emptyStatLine()} />
    </div>
  )
})

function BoxRow({ name, color, line }: { name: string; color: string; line: LiveStatLine }) {
  return (
    <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] items-center gap-x-3 px-3 py-1.5">
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <span className="truncate display text-sm leading-none">{name}</span>
      </span>
      <span className="text-right font-display text-sm font-bold tabular-nums" style={{ color }}>{line.points}</span>
      <span className="text-right font-display text-sm font-bold tabular-nums">{line.fgm}/{line.fga}</span>
      <span className="text-right font-display text-sm font-bold tabular-nums">{line.threePm}/{line.threePa}</span>
      <span className="text-right font-display text-sm font-bold tabular-nums">{line.turnovers}</span>
      <span className="text-right font-display text-sm font-bold tabular-nums">{line.foulsDrawn}</span>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* The Odds (live win probability)                                            */
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
        <Kicker tone="muted">The Odds</Kicker>
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
      <div className="mt-1 kicker text-muted-foreground/70">Model estimate — race-to-21 odds, not a prediction</div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Shooting splits (final comparison)                                         */
/* -------------------------------------------------------------------------- */

function ShootingSplits({ plays, nameA, nameB, colorA, colorB }: { plays: PlayByPlay[]; nameA: string; nameB: string; colorA: string; colorB: string }) {
  const box = useMemo(() => boxScoreThrough(plays, plays.length), [plays])
  return (
    <div className="p-3">
      <Kicker tone="muted">Shooting Splits</Kicker>
      <div className="mt-2 grid grid-cols-2 gap-3">
        <SplitColumn name={nameA} color={colorA} line={box[nameA] ?? emptyStatLine()} />
        <SplitColumn name={nameB} color={colorB} line={box[nameB] ?? emptyStatLine()} />
      </div>
    </div>
  )
}

function SplitColumn({ name, color, line }: { name: string; color: string; line: LiveStatLine }) {
  const rows = [
    { label: "Rim", made: line.rimMade, att: line.rimAtt },
    { label: "Mid", made: line.midMade, att: line.midAtt },
    { label: "3PT", made: line.threePm, att: line.threePa },
  ]
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate display text-sm leading-none">{lastName(name)}</span>
        <span className="font-display text-lg font-bold tabular-nums" style={{ color }}>{line.points}</span>
      </div>
      {rows.map((row) => {
        const p = row.att ? Math.round((row.made / row.att) * 100) : 0
        return (
          <div key={row.label} className="space-y-1">
            <div className="flex items-baseline justify-between font-condensed text-[0.66rem] font-bold uppercase tracking-[0.08em] text-muted-foreground">
              <span>{row.label}</span>
              <span className="tabular-nums text-foreground">
                {row.made}/{row.att}
                <span className="ml-1 text-muted-foreground">{row.att ? `${p}%` : "—"}</span>
              </span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full" style={{ width: `${p}%`, backgroundColor: color }} />
            </div>
          </div>
        )
      })}
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
    <div className="flex min-h-0 flex-col overflow-hidden rounded-sm border">
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
          <li className="px-3 py-3 font-condensed text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">Tip-off…</li>
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
        style={{ boxShadow: `inset 3px 0 0 0 ${current ? color : color + "33"}` }}
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

function resolvePalette(accentA?: string | null, accentB?: string | null): { colorA: string; colorB: string } {
  const a = accentA || VERMILLION
  const b = accentB || SLATE
  if (!accentA || !accentB || colorDistance(a, b) < 95) {
    return { colorA: VERMILLION, colorB: SLATE }
  }
  return { colorA: a, colorB: b }
}

function colorDistance(a: string, b: string): number {
  const ra = hexToRgb(a)
  const rb = hexToRgb(b)
  return Math.sqrt((ra[0] - rb[0]) ** 2 + (ra[1] - rb[1]) ** 2 + (ra[2] - rb[2]) ** 2)
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("")
}

function lastName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return parts[parts.length - 1] ?? name
}

function usePersistentToggle(key: string): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState(() => {
    if (typeof window === "undefined") return false
    return window.localStorage.getItem(key) === "1"
  })
  const set = (next: boolean) => {
    setValue(next)
    try {
      window.localStorage.setItem(key, next ? "1" : "0")
    } catch {
      /* ignore */
    }
  }
  return [value, set]
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
