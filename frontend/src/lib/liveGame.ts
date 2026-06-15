// Pure helpers for replaying a finished simulation as a live, possession-by-
// possession broadcast. The whole game is already computed server-side; these
// functions derive everything the live view needs (sides, running box score,
// a synthetic count-up game clock, ticker copy) from the play-by-play array, so
// playback is a deterministic, scrub-friendly client-side animation.

import { PlayByPlay } from "@/lib/simulation"
import {
  HOOP,
  RIM_R,
  ZONE_POSITIONS,
  arcControl,
  bandFromBasic,
  quadAt,
  shotPoint,
} from "@/lib/court"

// A possession enriched with the duel context we visualize: which side shot,
// the running lead, whether the lead just flipped, and any scoring-run milestone.
export interface EnrichedPlay {
  play: PlayByPlay
  side: "a" | "b"
  margin: number
  leadChange: boolean
  runSide: "a" | "b" | null
  runCallout: number | null
}

// Figure out which player name is "A" vs "B" purely from score deltas:
// score_a only grows on A's makes. Explicit name hints win; the complement
// covers a player who never scored. Keeps callers prop-free.
export function resolveSides(
  plays: PlayByPlay[],
  hintA?: string,
  hintB?: string
) {
  const map = new Map<string, "a" | "b">()
  let pa = 0
  let pb = 0
  for (const p of plays) {
    if (p.score_a > pa) map.set(p.offensive_player, "a")
    if (p.score_b > pb) map.set(p.offensive_player, "b")
    pa = p.score_a
    pb = p.score_b
  }
  const names = Array.from(new Set(plays.map((p) => p.offensive_player)))
  let nameA = hintA ?? [...map].find(([, s]) => s === "a")?.[0]
  let nameB = hintB ?? [...map].find(([, s]) => s === "b")?.[0]
  if (!nameA) nameA = names.find((n) => n !== nameB)
  if (!nameB) nameB = names.find((n) => n !== nameA)
  return { nameA: nameA ?? "Player A", nameB: nameB ?? "Player B" }
}

export function enrichPlays(plays: PlayByPlay[], nameA: string): EnrichedPlay[] {
  let prevMargin = 0
  let runSide: "a" | "b" | null = null
  let runPts = 0
  let lastEmitted = 0
  return plays.map((play, i) => {
    const prev = plays[i - 1]
    const pts =
      play.score_a -
      (prev?.score_a ?? 0) +
      (play.score_b - (prev?.score_b ?? 0))
    const side: "a" | "b" = play.offensive_player === nameA ? "a" : "b"
    const margin = play.score_a - play.score_b
    const leadChange =
      i > 0 &&
      margin !== 0 &&
      prevMargin !== 0 &&
      Math.sign(margin) !== Math.sign(prevMargin)

    let runCallout: number | null = null
    if (pts > 0) {
      if (runSide === side) {
        runPts += pts
      } else {
        runSide = side
        runPts = pts
        lastEmitted = 0
      }
      // Announce a run once it reaches 6, then again every +4 so it doesn't spam.
      if (runPts >= 6 && runPts - lastEmitted >= 4) {
        runCallout = runPts
        lastEmitted = runPts
      }
    }
    prevMargin = margin
    return { play, side, margin, leadChange, runSide, runCallout }
  })
}

export function formatShotType(shotType: string): string {
  if (shotType === "mid_range") {
    return "mid-range"
  }
  if (shotType === "three") {
    return "three-point"
  }
  return shotType
}

function zoneSide(area: string | null | undefined): string {
  const text = area ?? ""
  if (text.includes("Left")) return "left"
  if (text.includes("Right")) return "right"
  return ""
}

// A fuller, broadcast-style descriptor of the shot itself (no make/miss), using
// the real zone — e.g. "left corner three", "shot at the rim", "right mid-range".
export function shotDescriptor(play: PlayByPlay): string {
  if (play.turnover) return "Turnover"
  if (play.foul) return "Drew a foul"
  const side = zoneSide(play.shot_zone_area)
  if (play.shot_type === "three") {
    if ((play.shot_zone_basic ?? "").includes("Corner")) {
      return `${side ? side + " " : ""}corner three`
    }
    return side ? `${side}-wing three` : "top-of-the-key three"
  }
  if (play.shot_type === "rim") return "shot at the rim"
  return side ? `${side} mid-range jumper` : "mid-range jumper"
}

// Points a possession yields (0 for a miss/turnover/foul).
export function pointsForPlay(play: PlayByPlay): number {
  if (play.result !== "made") return 0
  return play.shot_type === "three" ? 3 : 2
}

// ---------------------------------------------------------------------------
// Per-zone shooting splits (for the shot-chart heat overlay)
// ---------------------------------------------------------------------------

export interface ZoneSplit {
  made: number
  att: number
}

export interface ZoneCell {
  key: string
  a: ZoneSplit
  b: ZoneSplit
}

export const zoneFgPct = (split: ZoneSplit): number =>
  split.att ? split.made / split.att : 0

const BAND_FALLBACK_KEY: Record<string, string> = {
  rim: "Restricted Area|Center(C)",
  mid_range: "Mid-Range|Center(C)",
  three: "Above the Break 3|Center(C)",
}

// Resolve a shot to a real ZONE_POSITIONS key (so the tint always has a
// coordinate), falling back to the band's anchor for an unmapped label.
function zoneKeyForPlay(play: PlayByPlay): string {
  const exact = `${play.shot_zone_basic ?? ""}|${play.shot_zone_area ?? ""}`
  return ZONE_POSITIONS[exact]
    ? exact
    : BAND_FALLBACK_KEY[bandFromBasic(play.shot_zone_basic)]
}

// Bucket the first `count` field-goal attempts into per-zone, per-player
// made/att tallies. Turnovers and fouls (no shot location) are skipped.
export function zoneSplitsThrough(
  plays: PlayByPlay[],
  count: number,
  nameA: string
): Record<string, ZoneCell> {
  const cells: Record<string, ZoneCell> = {}
  const ensure = (key: string) =>
    (cells[key] ??= { key, a: { made: 0, att: 0 }, b: { made: 0, att: 0 } })
  const limit = Math.min(count, plays.length)
  for (let i = 0; i < limit; i++) {
    const play = plays[i]
    if (play.result !== "made" && play.result !== "missed") continue
    const cell = ensure(zoneKeyForPlay(play))
    const side = play.offensive_player === nameA ? cell.a : cell.b
    side.att++
    if (play.result === "made") side.made++
  }
  return cells
}

// ---------------------------------------------------------------------------
// Synthetic game clock
// ---------------------------------------------------------------------------

export interface PossessionTiming {
  start: number
  duration: number
}

// Fractional part of a number — shared with the broadcast's deterministic
// jitter/scatter so there's one definition.
export function frac(value: number): number {
  return value - Math.floor(value)
}

// The ball flies at one fixed speed, in court-units per game-second. Because the
// flight time is then distance / speed, a long three hangs in the air longer
// than a layup — exactly as a real shot does. (At 1x, 1 real second ≈ BASE_RATE
// game-seconds, so this also sets the on-screen pace.)
const BALL_SPEED = 56
// Even a point-blank shot is airborne for at least this long, so it's visible.
const MIN_FLIGHT = 1.8
// Game-seconds around the flight: a quiet beat before the shot, the trace/net
// lingering after the ball arrives, then a quiet tail before the next possession.
const SHOT_BEAT = 2.4
const SHOT_FADE = 3
const SHOT_TAIL = 2

// A shot's geometry plus how long the ball is airborne — shared by the timeline
// (which sizes the possession slot) and the projectile (which animates inside
// it), so the two always agree. Flight time = arc length / BALL_SPEED, giving a
// constant ball speed regardless of where the shot is taken from.
function shotArc(play: PlayByPlay) {
  const launch = shotPoint(play.shot_zone_basic, play.shot_zone_area, play.possession)
  const control = arcControl(launch.x, launch.y)
  const made = play.result === "made"
  // A make terminates at the hoop's center (the ball drops in). A miss flies
  // all the way to the rim and CONTACTS it — at a per-possession point on the
  // iron (front rim, side rim, a graze off the edge…) picked deterministically
  // around the side facing the shot, so consecutive misses don't all clank off
  // the same spot. The carom is drawn radially off that contact (see ShotFx),
  // so a miss never looks like the ball simply died in mid-air.
  let end = HOOP
  if (!made) {
    const approach = Math.atan2(launch.y - HOOP.y, launch.x - HOOP.x)
    const angle =
      approach + (frac(Math.sin((play.possession + 1) * 17.9)) - 0.5) * 1.6
    end = {
      x: HOOP.x + Math.cos(angle) * (RIM_R + 1),
      y: HOOP.y + Math.sin(angle) * (RIM_R + 1),
    }
  }
  // Sample the Bézier so the flight tracks the real arc length, not the chord.
  let length = 0
  let prev = launch
  for (let i = 1; i <= 12; i++) {
    const p = quadAt(launch, control, end, i / 12)
    length += Math.hypot(p.x - prev.x, p.y - prev.y)
    prev = p
  }
  const flight = Math.max(MIN_FLIGHT, length / BALL_SPEED)
  return { launch, control, end, made, flight }
}

const isShotPlay = (play: PlayByPlay): boolean =>
  play.result === "made" || play.result === "missed"

// Game-seconds a possession "consumes" on the count-up clock. The duel is a race
// to 21 with no real clock, so this is purely stylistic flavor. A shot's slot is
// sized to hold its constant-speed flight (beat + flight + fade + tail), so a
// distant shot's longer hang time naturally makes its possession run longer;
// non-shot possessions get a flat base with a little deterministic jitter.
function possessionDuration(play: PlayByPlay): number {
  if (isShotPlay(play)) {
    return Math.round(SHOT_BEAT + shotArc(play).flight + SHOT_FADE + SHOT_TAIL)
  }
  const base = play.turnover ? 8 : 11 // turnover vs foul
  const jitter = Math.round((frac(Math.sin((play.possession + 1) * 53.17)) - 0.5) * 8)
  return Math.max(4, base + jitter)
}

// Lay every possession out on a single elapsed timeline. `timings[i].start` is
// when possession i is revealed; `totalSeconds` is the full game length.
export function buildTimeline(plays: PlayByPlay[]): {
  timings: PossessionTiming[]
  totalSeconds: number
} {
  const timings: PossessionTiming[] = []
  let elapsed = 0
  for (const play of plays) {
    const duration = possessionDuration(play)
    timings.push({ start: elapsed, duration })
    elapsed += duration
  }
  return { timings, totalSeconds: elapsed }
}

export function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`
}

// ---------------------------------------------------------------------------
// The shot projectile — the ball appears ONLY while a shot is in flight (a thin
// trace that draws then fades, in the shooter's accent colour: solid for a make,
// dashed for a miss). Derived from the clock so it survives pause / scrub /
// speed. Between shots the floor is quiet; only the player markers show
// possession.
// ---------------------------------------------------------------------------

type Point = { x: number; y: number }

export interface ActiveShot {
  possession: number
  launch: Point
  control: Point
  end: Point // arc terminus (hoop center for a make; the rim's near edge for a miss)
  made: boolean
  three: boolean
  arcT: number // 0..1 across launch → rim (drives the trace + ball head)
  fadeT: number // 0..1 after the ball arrives (trace fade + make rim flash)
}

// Clamp to [0,1] — shared with the broadcast's clock-driven FX math.
export const clamp01 = (t: number) => Math.max(0, Math.min(1, t))

// The possession whose timeline slot contains `clock`, or -1. Shared by the
// shot and event flourishes so they locate the active possession identically.
function possessionIndexAt(clock: number, timings: PossessionTiming[]): number {
  for (let k = 0; k < timings.length; k++) {
    const t = timings[k]
    if (clock >= t.start && clock < t.start + t.duration) return k
  }
  return -1
}

export function activeShotAt(
  clock: number,
  plays: PlayByPlay[],
  timings: PossessionTiming[]
): ActiveShot | null {
  const index = possessionIndexAt(clock, timings)
  if (index < 0) return null
  const play = plays[index]
  if (!isShotPlay(play)) return null
  const t = timings[index]

  const { launch, control, end, made, flight } = shotArc(play)
  // Absolute offsets within the slot: a quiet beat, then a constant-speed flight
  // whose length scales with distance, then the fade. (The slot was sized for
  // exactly this in possessionDuration, so it always fits with room to spare.)
  const launchAt = t.start + SHOT_BEAT
  const landAt = launchAt + flight
  const fadeEndAt = landAt + SHOT_FADE
  if (clock < launchAt || clock >= fadeEndAt) return null

  return {
    possession: play.possession,
    launch,
    control,
    end,
    made,
    three: play.shot_type === "three",
    arcT: clamp01((clock - launchAt) / (landAt - launchAt)),
    fadeT: clamp01((clock - landAt) / (fadeEndAt - landAt)),
  }
}

// A foul drawn or a turnover/steal has no shot location; on the floor it surfaces
// as a persistent, hoverable glyph inside the ball-handler's circle (see
// BroadcastStrip's eventEls). This kind tag picks the glyph.
export type LiveEventKind = "foul" | "turnover"

// The transient flourish that fires WHEN a non-shot possession happens during
// live playback — a swelling, wobbling whistle with sound-rings for a drawn
// foul; a swelling steal-hand with the ball bouncing loose for a turnover. Like
// ActiveShot it's a pure function of the clock, so pause / scrub / speed replay
// it faithfully. `t` is 0..1 over the flourish.
export interface ActiveEvent {
  possession: number
  kind: LiveEventKind
  t: number
}

// A quiet beat, then the flourish. Kept within the briefest non-shot slot (the
// minimum is ~4 game-seconds; see possessionDuration) but long enough that the
// whistle's sound-rings read as an unhurried pulse rather than a fast blip.
const EVENT_BEAT = 0.6
const EVENT_PLAY = 3.2

export function activeEventAt(
  clock: number,
  plays: PlayByPlay[],
  timings: PossessionTiming[]
): ActiveEvent | null {
  const index = possessionIndexAt(clock, timings)
  if (index < 0) return null
  const play = plays[index]
  if (isShotPlay(play) || !(play.turnover || play.foul)) return null
  const t0 = timings[index].start + EVENT_BEAT
  const t1 = t0 + EVENT_PLAY
  if (clock < t0 || clock >= t1) return null
  return {
    possession: play.possession,
    kind: play.turnover ? "turnover" : "foul",
    t: clamp01((clock - t0) / (t1 - t0)),
  }
}

// ---------------------------------------------------------------------------
// Running box score
// ---------------------------------------------------------------------------

export interface LiveStatLine {
  points: number
  fgm: number
  fga: number
  threePm: number
  threePa: number
  rimMade: number
  rimAtt: number
  midMade: number
  midAtt: number
  turnovers: number
  foulsDrawn: number
}

export function emptyStatLine(): LiveStatLine {
  return {
    points: 0,
    fgm: 0,
    fga: 0,
    threePm: 0,
    threePa: 0,
    rimMade: 0,
    rimAtt: 0,
    midMade: 0,
    midAtt: 0,
    turnovers: 0,
    foulsDrawn: 0,
  }
}

// Reconstruct each player's running line from the first `count` possessions —
// every field is derivable from result / shot_type, so the live box score stays
// in lock-step with the revealed play-by-play.
export function boxScoreThrough(
  plays: PlayByPlay[],
  count: number
): Record<string, LiveStatLine> {
  const lines: Record<string, LiveStatLine> = {}
  const ensure = (name: string) => (lines[name] ??= emptyStatLine())
  const limit = Math.min(count, plays.length)
  for (let i = 0; i < limit; i++) {
    const play = plays[i]
    const line = ensure(play.offensive_player)
    if (play.turnover) {
      line.turnovers++
      continue
    }
    if (play.foul) {
      line.foulsDrawn++
      continue
    }
    const made = play.result === "made"
    line.fga++
    if (made) line.fgm++
    if (play.shot_type === "three") {
      line.threePa++
      if (made) {
        line.threePm++
        line.points += 3
      }
    } else if (play.shot_type === "rim") {
      line.rimAtt++
      if (made) {
        line.rimMade++
        line.points += 2
      }
    } else {
      line.midAtt++
      if (made) {
        line.midMade++
        line.points += 2
      }
    }
  }
  return lines
}
