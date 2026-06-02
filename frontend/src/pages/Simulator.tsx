import {
  CSSProperties,
  Fragment,
  ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react"
import { useSearchParams } from "react-router-dom"
import axios from "axios"
import { API_BASE_URL } from "@/lib/config"
import {
  AlertTriangle,
  CalendarDays,
  ChevronDown,
  CornerDownLeft,
  Dices,
  Info,
  ListOrdered,
  Loader2,
  MoveHorizontal,
  Pencil,
  Percent,
  Repeat,
  RotateCcw,
  Ruler,
  Shuffle,
  Sparkles,
  Swords,
  UserRound,
  Weight,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { getTeamColor, getTeamLogoUrl, withAlpha } from "@/lib/teamColors"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card"
import { PlayerSearchCombobox } from "@/components/PlayerSearchCombobox"
import { HalftoneAvatar, Kicker, Rule } from "@/components/editorial"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { PlayerProfile, usePlayerSearch } from "@/hooks/usePlayerSearch"
import {
  PlayerSeasonStats,
  usePlayerSeasons,
  usePlayerSeasonStats,
} from "@/hooks/usePlayerSeasons"
import {
  ConfidenceTier,
  MatchSummary,
  PlayByPlay,
  PlayerSimStats,
  SimulationResult,
} from "@/lib/simulation"
import TendencyComparisonPanel from "@/pages/TendencyComparisonPanel"
import ShotChartSheet, { ShotChartTarget } from "@/pages/ShotChartSheet"

type SlotLabel = "Player A" | "Player B"

type PossessionMode = "make_it_take_it" | "alternating"

// "Winners" = make-it-take-it (the scorer keeps possession); "Losers" = the
// ball always changes hands, so the player who was just scored on gets it next.
// The backend contract still uses make_it_take_it / alternating.
const POSSESSION_MODES: {
  value: PossessionMode
  label: string
  hint: string
  icon: typeof Repeat
}[] = [
  {
    value: "make_it_take_it",
    label: "Winners",
    hint: "Winner's ball — score and you keep possession (make-it-take-it).",
    icon: Repeat,
  },
  {
    value: "alternating",
    label: "Losers",
    hint: "Loser's ball — get scored on and you get it back (possession alternates).",
    icon: Shuffle,
  },
]

const CONFIDENCE_TOOLTIPS: Record<ConfidenceTier, string> = {
  HIGH: "VERIFIED: sufficient matchup tracking data available for this player.",
  MEDIUM:
    "ON RECORD: post-tracking era player with limited observed data.",
  LOW: "ESTIMATED: pre-tracking era or statistical outlier — model-generalized profile.",
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

// One-click recommendations shown in the empty player card. Names resolve
// through the same /player search as a typed pick; the id is only used to load
// the headshot up front (same NBA CDN as PlayerAvatar). Each slot gets a
// distinct set so A and B don't mirror each other.
type QuickPick = { id: number; name: string }

const QUICK_PICKS_A: QuickPick[] = [
  { id: 893, name: "Michael Jordan" },
  { id: 977, name: "Kobe Bryant" },
  { id: 201939, name: "Stephen Curry" },
  { id: 947, name: "Allen Iverson" },
  { id: 77142, name: "Magic Johnson" },
  { id: 2548, name: "Dwyane Wade" },
]

const QUICK_PICKS_B: QuickPick[] = [
  { id: 2544, name: "LeBron James" },
  { id: 201142, name: "Kevin Durant" },
  { id: 203507, name: "Giannis Antetokounmpo" },
  { id: 1449, name: "Larry Bird" },
  { id: 165, name: "Hakeem Olajuwon" },
  { id: 406, name: "Shaquille O'Neal" },
]

// Curated classic rivalries for the "Surprise me" shuffle and the sample bout
// shown on a cold (no-params) arrival. Names resolve through the same /player
// search as a typed pick; `tag` is the editorial billing for the verdict-style
// header. The first entry doubles as the default featured matchup.
type Rivalry = { tag: string; a: string; b: string }

const RIVALRIES: Rivalry[] = [
  { tag: "The Main Event", a: "Michael Jordan", b: "LeBron James" },
  { tag: "Era Clash", a: "Stephen Curry", b: "Magic Johnson" },
  { tag: "The Co-Main", a: "Kobe Bryant", b: "Kevin Durant" },
  { tag: "In the Trenches", a: "Shaquille O'Neal", b: "Hakeem Olajuwon" },
  { tag: "Lead Guards", a: "Allen Iverson", b: "Stephen Curry" },
  { tag: "Greek Freak vs. Legend", a: "Giannis Antetokounmpo", b: "Larry Bird" },
  { tag: "Flash vs. Bird", a: "Dwyane Wade", b: "Larry Bird" },
]

// A request from the controller to load a named player into the slot (used by
// deep-link preload and the "Surprise me" shuffle). The `token` makes each
// request unique so repeating the same name still re-fires the effect.
interface PreloadRequest {
  name: string
  token: number
}

interface PlayerSlotProps {
  label: SlotLabel
  selectedPlayer: PlayerProfile | null
  selectedSeason: string | null
  onSelect: (player: PlayerProfile) => void
  onClear: () => void
  onSeasonSelect: (seasonId: string | null) => void
  onSeasonStatsChange?: (stats: PlayerSeasonStats | null) => void
  confidenceTier?: ConfidenceTier | null
  // When set, the slot resolves this name via the same path as a quick-pick.
  preload?: PreloadRequest | null
  onPreloadHandled?: () => void
  // Results mode: collapse the heavy vitals + season stat-bar body to keep just
  // the player identity header + season selector, so the verdict is the hero.
  compact?: boolean
}

function PlayerSelectionController() {
  const [playerA, setPlayerA] = useState<PlayerProfile | null>(null)
  const [playerB, setPlayerB] = useState<PlayerProfile | null>(null)
  const [seasonA, setSeasonA] = useState<string | null>(null)
  const [seasonB, setSeasonB] = useState<string | null>(null)
  // Per-season stats bubble up from each PlayerSlot (which already fetched them)
  // so the TendencyComparisonPanel can read them without issuing new API calls.
  const [seasonStatsA, setSeasonStatsA] = useState<PlayerSeasonStats | null>(null)
  const [seasonStatsB, setSeasonStatsB] = useState<PlayerSeasonStats | null>(null)
  const [shotChartTarget, setShotChartTarget] = useState<ShotChartTarget | null>(
    null
  )
  const [possessionMode, setPossessionMode] =
    useState<PossessionMode>("make_it_take_it")
  const [simulationResult, setSimulationResult] =
    useState<SimulationResult | null>(null)
  const [simulationLoading, setSimulationLoading] = useState(false)
  const [simulationError, setSimulationError] = useState<string | null>(null)
  const [bulkResult, setBulkResult] = useState<BulkSimulationResult | null>(null)
  const [bulkLoading, setBulkLoading] = useState(false)
  // Preload requests pushed down into each slot (deep-link + "Surprise me").
  const [preloadA, setPreloadA] = useState<PreloadRequest | null>(null)
  const [preloadB, setPreloadB] = useState<PreloadRequest | null>(null)
  // Editorial billing for the active sample/shuffled bout, shown until the user
  // edits a corner. Cleared on any manual change so it never lies.
  const [billing, setBilling] = useState<string | null>(null)
  // Tip-off reveal beat: a brief overlay flashed before results land. It plays
  // only on the FIRST single-game run for a given matchup — `hasTippedOff`
  // tracks that and resets whenever the matchup (either player) changes or a
  // fresh bout is loaded, so a brand-new pairing earns the dramatic intro again.
  // The tip-off content (the two names + optional editorial billing) and a
  // separate visibility flag so the overlay can fade out while the content
  // stays mounted through the transition.
  const [tipOffData, setTipOffData] = useState<{
    a: string
    b: string
    tag?: string
  } | null>(null)
  const [tipOffShow, setTipOffShow] = useState(false)
  const hasTippedOff = useRef(false)
  const tipOffTimer = useRef<number | null>(null)
  // Progressive disclosure: once a result exists, the setup detail (per-game
  // stat bars + the By-the-Numbers comparison) and the full play-by-play start
  // collapsed so the verdict + box score are the calm hero. Both re-expand on tap.
  const [setupExpanded, setSetupExpanded] = useState(false)
  const [playByPlayOpen, setPlayByPlayOpen] = useState(false)
  const [searchParams] = useSearchParams()
  // A matchup is only runnable once both players are confirmed AND each has a
  // season selected (AC-ISO-001.6 / AC-ISO-006.1).
  const canRunSimulation = Boolean(playerA && playerB && seasonA && seasonB)
  const busy = simulationLoading || bulkLoading
  // "Results mode": a single-game or 1,000-sim result exists, so the pre-run
  // setup detail is de-emphasized behind an "edit matchup" toggle.
  const hasResults = Boolean(simulationResult || bulkResult)
  // Surfaced in the ready banner and the disabled-run tooltip.
  const readyHint = runRequirementHint(playerA, playerB, seasonA, seasonB)

  const tokenRef = useRef(0)
  const nextToken = () => ++tokenRef.current

  // Load a curated rivalry (or a deep-linked pair) into both corners by pushing
  // a preload request into each slot — they resolve names via the same search
  // path as the quick-pick tiles, which auto-selects each default season.
  const loadBout = useCallback((rivalry: Rivalry) => {
    setPreloadA({ name: rivalry.a, token: nextToken() })
    setPreloadB({ name: rivalry.b, token: nextToken() })
    setBilling(rivalry.tag)
    // Fresh bout (deep-link / Surprise me / sample) is a new matchup — re-arm
    // the dramatic tip-off intro.
    hasTippedOff.current = false
  }, [])

  // Play the dramatic "tip-off" beat: a blurred full-bleed flash framing the
  // two names, with the editorial billing fading in above them a touch later.
  // Skipped entirely for reduced-motion users.
  const playTipOff = useCallback((a: string, b: string, tag?: string) => {
    if (prefersReducedMotion()) return
    setTipOffData({ a, b, tag })
    setTipOffShow(true)
    if (tipOffTimer.current !== null) {
      window.clearTimeout(tipOffTimer.current)
    }
    tipOffTimer.current = window.setTimeout(() => {
      setTipOffShow(false)
      tipOffTimer.current = null
    }, 1600)
  }, [])

  function surpriseMe() {
    const pick = RIVALRIES[Math.floor(Math.random() * RIVALRIES.length)]
    loadBout(pick)
    // Same tip-off reveal as a first run, billed with the rivalry's nickname.
    playTipOff(pick.a, pick.b, pick.tag)
  }

  // Deep-link / cold-start preload, run exactly once on mount. With ?a=&b= we
  // honor the requested matchup; with neither we drop in a featured sample bout
  // so the page is never empty (clearly labeled and fully swappable).
  const didPreload = useRef(false)
  useEffect(() => {
    if (didPreload.current) return
    didPreload.current = true
    const a = searchParams.get("a")?.trim()
    const b = searchParams.get("b")?.trim()
    if (a && b) {
      loadBout({ tag: "Your Matchup", a, b })
    } else if (a || b) {
      // Only one corner specified — fill it and leave the other for the user.
      if (a) setPreloadA({ name: a, token: nextToken() })
      if (b) setPreloadB({ name: b, token: nextToken() })
      setBilling("Pick a challenger")
    } else {
      loadBout({ ...RIVALRIES[0], tag: "Sample bout — swap in anyone" })
    }
  }, [searchParams, loadBout])

  function selectPlayerA(player: PlayerProfile | null) {
    setPlayerA(player)
    setSeasonA(null)
    setBulkResult(null)
    setSimulationResult(null)
    setBilling(null)
    // New matchup — re-arm the dramatic tip-off intro.
    hasTippedOff.current = false
  }

  function selectPlayerB(player: PlayerProfile | null) {
    setPlayerB(player)
    setSeasonB(null)
    setBulkResult(null)
    setSimulationResult(null)
    setBilling(null)
    // New matchup — re-arm the dramatic tip-off intro.
    hasTippedOff.current = false
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
    // Dramatic name-vs-name "tip-off" beat — shown only the FIRST time this
    // matchup is run (Surprise me triggers its own). Every re-run ("Run it
    // back") and the bulk 1,000-sim fall back to the simpler button/action-bar
    // spinner instead. Non-blocking (the sim is already in flight above).
    if (!hasTippedOff.current) {
      hasTippedOff.current = true
      playTipOff(playerA.name, playerB.name, billing ?? undefined)
    }

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
      // Land in the calm results view: setup detail + diary start collapsed.
      setSetupExpanded(false)
      setPlayByPlayOpen(false)
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
      setSetupExpanded(false)
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

  // Press Enter to run when the matchup is ready (ignored while typing in an
  // input / when a popover or select is capturing keys).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Enter" || event.metaKey || event.ctrlKey) return
      const el = event.target as HTMLElement | null
      const tag = el?.tagName
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        el?.isContentEditable ||
        el?.closest("[role='dialog'],[role='listbox'],[role='combobox']")
      ) {
        return
      }
      if (canRunSimulation && !busy) {
        event.preventDefault()
        runSimulation()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
    // runSimulation closes over the current selection; re-bind when readiness
    // or busy state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRunSimulation, busy])

  // Clear any pending tip-off fade-out timer on unmount.
  useEffect(() => {
    return () => {
      if (tipOffTimer.current !== null) {
        window.clearTimeout(tipOffTimer.current)
      }
    }
  }, [])

  return (
    <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-screen-xl flex-col px-4 py-8 md:px-6">
      <div className="mb-6 flex flex-col gap-4 pb-6 duration-700 animate-in fade-in slide-in-from-bottom-4 [animation-fill-mode:both] md:flex-row md:items-end md:justify-between">
        <div>
          <Kicker ruled>The ISO Lab</Kicker>
          <h1 className="mt-2 display text-5xl sm:text-6xl">Tale of the Tape</h1>
          <p className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-condensed text-[0.78rem] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            <span>Two players</span>
            <span aria-hidden>·</span>
            <span>Any two eras</span>
            <span aria-hidden>·</span>
            <span>
              First to <span className="tabular-nums text-foreground">21</span>
            </span>
          </p>
        </div>
        <div className="flex flex-col items-stretch gap-3 sm:items-end">
          <PossessionModeToggle
            value={possessionMode}
            onChange={setPossessionMode}
            disabled={busy}
          />
          <Button
            variant="outline"
            disabled={busy}
            onClick={surpriseMe}
            className="font-condensed font-bold uppercase tracking-[0.14em] sm:w-auto"
          >
            <Dices className="h-4 w-4" />
            Surprise me
          </Button>
        </div>
      </div>
      <Rule weight="double" className="mb-6" />

      {billing && (
        <div className="mb-4 flex items-center justify-center gap-2 animate-in fade-in [animation-fill-mode:both]">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span className="kicker text-primary">{billing}</span>
        </div>
      )}

      <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-[1fr_auto_1fr] lg:items-start">
        <PlayerSlot
          label="Player A"
          selectedPlayer={playerA}
          selectedSeason={seasonA}
          onSelect={selectPlayerA}
          onClear={() => selectPlayerA(null)}
          onSeasonSelect={selectSeasonA}
          onSeasonStatsChange={setSeasonStatsA}
          preload={preloadA}
          onPreloadHandled={() => setPreloadA(null)}
          compact={hasResults && !setupExpanded}
          confidenceTier={
            playerA
              ? simulationResult?.summary.player_stats[playerA.name]
                  ?.confidence_tier ?? null
              : null
          }
        />
        <div className="hidden h-full flex-col items-center justify-center gap-3 self-stretch lg:flex">
          <span className="font-display text-5xl font-black italic leading-none text-foreground/70">
            vs.
          </span>
          <Rule vertical className="flex-1" />
        </div>
        <PlayerSlot
          label="Player B"
          selectedPlayer={playerB}
          selectedSeason={seasonB}
          onSelect={selectPlayerB}
          onClear={() => selectPlayerB(null)}
          onSeasonSelect={selectSeasonB}
          onSeasonStatsChange={setSeasonStatsB}
          preload={preloadB}
          onPreloadHandled={() => setPreloadB(null)}
          compact={hasResults && !setupExpanded}
          confidenceTier={
            playerB
              ? simulationResult?.summary.player_stats[playerB.name]
                  ?.confidence_tier ?? null
              : null
          }
        />
      </div>

      {/* Results mode: a one-line "edit matchup" affordance to re-expand the
          collapsed setup detail (vitals + stat bars + the comparison panel), so
          you don't scroll past full input panels to read the verdict. */}
      {hasResults && (
        <div className="mt-3 flex justify-center">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSetupExpanded((open) => !open)}
            className="font-condensed text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground"
            aria-expanded={setupExpanded}
          >
            <Pencil className="h-3.5 w-3.5" />
            {setupExpanded ? "Hide matchup detail" : "Edit matchup"}
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 transition-transform",
                setupExpanded && "rotate-180"
              )}
            />
          </Button>
        </div>
      )}

      {/* Tendency Explorer comparison panel: appears automatically once both
          players and seasons are confirmed and their season stats have loaded,
          below the player cards and ahead of the simulation results. The
          season_id guard avoids rendering against a previous season's stats
          while a newly selected season is still loading. In results mode it's
          collapsed behind the "Edit matchup" toggle above. */}
      {(!hasResults || setupExpanded) &&
        playerA &&
        playerB &&
        seasonA &&
        seasonB &&
        seasonStatsA?.season_id === seasonA &&
        seasonStatsB?.season_id === seasonB && (
          <TendencyComparisonPanel
            playerA={playerA}
            playerB={playerB}
            seasonA={seasonA}
            seasonB={seasonB}
            statsA={seasonStatsA}
            statsB={seasonStatsB}
            onViewShotChart={(player, seasonId) =>
              setShotChartTarget({
                playerId: player.player_id,
                playerName: player.name,
                seasonId,
              })
            }
          />
        )}

      <ShotChartSheet
        target={shotChartTarget}
        onOpenChange={(open) => {
          if (!open) setShotChartTarget(null)
        }}
      />

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
        <div className="mt-6 space-y-4">
          {/* The single-game box score (secondary to the 1,000-sim verdict). */}
          <MatchSummaryView
            summary={simulationResult.summary}
            playerAName={playerA.name}
            playerBName={playerB.name}
            onRerun={runSimulation}
            rerunDisabled={busy}
          />

          {/* The Running Diary is the heaviest region — collapsed by default
              behind a toggle, with the lead-margin summary still in reach via
              the button copy. The exported PlayByPlayView is unchanged. */}
          <div>
            <Button
              variant="outline"
              onClick={() => setPlayByPlayOpen((open) => !open)}
              aria-expanded={playByPlayOpen}
              className="w-full justify-center font-condensed text-sm font-bold uppercase tracking-[0.14em] tabular-nums"
            >
              <ListOrdered className="h-4 w-4" />
              {playByPlayOpen
                ? "Hide play-by-play"
                : `Show play-by-play (${simulationResult.play_by_play.length} possessions)`}
              <ChevronDown
                className={cn(
                  "h-4 w-4 transition-transform",
                  playByPlayOpen && "rotate-180"
                )}
              />
            </Button>
            {playByPlayOpen && (
              <div className="mt-4 animate-in fade-in slide-in-from-bottom-2 [animation-fill-mode:both]">
                <PlayByPlayView playByPlay={simulationResult.play_by_play} />
              </div>
            )}
          </div>
        </div>
      )}

      <RunActionBar
        canRun={canRunSimulation}
        busy={busy}
        simulationLoading={simulationLoading}
        bulkLoading={bulkLoading}
        hasResult={Boolean(simulationResult)}
        readyHint={readyHint}
        onRun={runSimulation}
        onRunBulk={runBulkSimulation}
      />

      <TipOffOverlay show={tipOffShow} data={tipOffData} />
    </div>
  )
}

// A sticky bottom action bar that keeps the primary Run control reachable on
// any scroll position. The ready/not-ready state is spelled out so the disabled
// state is never a mystery (it mirrors the Enter-to-run guard).
function RunActionBar({
  canRun,
  busy,
  simulationLoading,
  bulkLoading,
  hasResult,
  readyHint,
  onRun,
  onRunBulk,
}: {
  canRun: boolean
  busy: boolean
  simulationLoading: boolean
  bulkLoading: boolean
  hasResult: boolean
  readyHint: string
  onRun: () => void
  onRunBulk: () => void
}) {
  return (
    <div className="sticky bottom-0 z-30 -mx-4 mt-6 border-t border-border bg-background/85 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/70 md:-mx-6 md:px-6">
      <div className="mx-auto flex w-full max-w-screen-xl flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "size-2 shrink-0 rounded-full",
              canRun ? "bg-court" : "bg-muted-foreground/40"
            )}
            aria-hidden
          />
          <span
            className={cn(
              "truncate kicker",
              canRun ? "text-foreground" : "text-muted-foreground"
            )}
          >
            {canRun ? "Ready — first to 21" : readyHint}
          </span>
        </div>
        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
          <Button
            variant="secondary"
            size="lg"
            disabled={!canRun || busy}
            className="w-full font-condensed font-bold uppercase tracking-[0.14em] tabular-nums sm:w-auto"
            onClick={onRunBulk}
          >
            {bulkLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Percent className="h-4 w-4" />
            )}
            {bulkLoading ? "Tallying 1,000…" : "Simulate 1,000"}
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              {/* Wrapped in a span so the tooltip still fires while the button
                  is disabled (disabled controls emit no hover). */}
              <span className="flex w-full sm:w-auto">
                <Button
                  disabled={!canRun || busy}
                  size="lg"
                  className="w-full font-condensed font-bold uppercase tracking-[0.14em] sm:w-auto"
                  onClick={onRun}
                >
                  {simulationLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Swords className="h-4 w-4" />
                  )}
                  {hasResult ? "Run it back" : "Run game"}
                  {canRun && !busy && (
                    <kbd className="ml-1 hidden items-center gap-0.5 rounded-sm bg-primary-foreground/20 px-1.5 py-0.5 font-condensed text-[0.7rem] sm:inline-flex">
                      <CornerDownLeft className="h-3 w-3" />
                    </kbd>
                  )}
                </Button>
              </span>
            </TooltipTrigger>
            {!canRun && <TooltipContent>{readyHint}</TooltipContent>}
          </Tooltip>
        </div>
      </div>
    </div>
  )
}

// The "tip-off" beat: a dramatic full-bleed flash framing the two names as a
// verdict is computed. It lingers ~1s (the controller toggles `show` off after
// that) and fades smoothly in and out via an opacity transition, so it stays
// readable. Always non-blocking (pointer-events-none) so the sim runs beneath.
// Only ever rendered with `show` toggling for the first run of a matchup;
// reduced-motion users never see it (the controller skips the beat entirely).
function TipOffOverlay({
  show,
  data,
}: {
  show: boolean
  data: { a: string; b: string; tag?: string } | null
}) {
  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm transition-opacity duration-500 ease-in-out",
        show ? "opacity-100" : "opacity-0"
      )}
      aria-hidden
    >
      <div
        className={cn(
          "flex flex-col items-center gap-3 transition-all duration-500 ease-out",
          show ? "scale-100 opacity-100" : "scale-95 opacity-0"
        )}
      >
        {/* Editorial billing (the rivalry nickname) — fades in a beat after the
            names land, in vermillion, like a fight-card subtitle. */}
        {data?.tag && (
          <span
            className={cn(
              "font-display text-base font-bold italic tracking-tight text-primary transition-all duration-700 ease-out [transition-delay:400ms] sm:text-xl",
              show ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
            )}
          >
            {data.tag}
          </span>
        )}
        <div className="flex items-center gap-4">
          <span className="display text-3xl sm:text-5xl">
            {lastNameOf(data?.a ?? "")}
          </span>
          <span className="font-display text-2xl font-black italic text-primary sm:text-3xl">
            vs.
          </span>
          <span className="display text-3xl sm:text-5xl">
            {lastNameOf(data?.b ?? "")}
          </span>
        </div>
      </div>
    </div>
  )
}

// Respect the user's reduced-motion preference for the tip-off beat.
function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  )
}

function PlayerSlot({
  label,
  selectedPlayer,
  selectedSeason,
  onSelect,
  onClear,
  onSeasonSelect,
  onSeasonStatsChange,
  confidenceTier,
  preload,
  onPreloadHandled,
  compact = false,
}: PlayerSlotProps) {
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
  const { searchPlayer } = usePlayerSearch()
  // Name of the quick-pick currently being resolved, so its chip can show a
  // spinner (the rest are disabled while one is in flight).
  const [resolvingPick, setResolvingPick] = useState<string | null>(null)
  // Name being resolved from a controller preload (deep-link / Surprise me), so
  // the empty card can show a clear "loading" state instead of a cold start.
  const [preloadingName, setPreloadingName] = useState<string | null>(null)
  const quickPicks = label === "Player A" ? QUICK_PICKS_A : QUICK_PICKS_B

  const profile = selectedPlayer

  // Team branding follows the selected season: the card accent color, the logo
  // on the headshot, and the team badge all reflect who the player suited up
  // for that year.
  const seasonTeamColor = getTeamColor(seasonStats?.team_abbreviation)
  const seasonTeamLogo = getTeamLogoUrl(seasonStats?.team_id)
  const seasonTeam = seasonStats?.team_abbreviation || null

  // Bubble the loaded season stats up to the parent so TendencyComparisonPanel
  // can read them without re-fetching. onSeasonStatsChange is a stable setter.
  useEffect(() => {
    onSeasonStatsChange?.(seasonStats)
  }, [seasonStats, onSeasonStatsChange])

  // Confirm a player picked from the combobox: load the player's seasons, then
  // default the selection to the most recent one (the list is returned
  // newest-first) so the matchup is runnable immediately. The user can still
  // pick a different season from the dropdown.
  async function confirmPlayer(result: PlayerProfile) {
    onSelect(result)
    clearSeasonStats()
    const loadedSeasons = await loadSeasons(result.player_id)
    const mostRecentSeason = loadedSeasons?.[0]?.season_id ?? null
    onSeasonSelect(mostRecentSeason)
    if (mostRecentSeason) {
      loadSeasonStats(result.player_id, mostRecentSeason)
    }
  }

  // A quick-pick resolves the name to a full profile, then runs the same
  // confirm flow as a search selection (load seasons + most-recent stats).
  async function quickPick(name: string) {
    setResolvingPick(name)
    try {
      const result = await searchPlayer(name)
      if (result) {
        await confirmPlayer(result)
      }
    } finally {
      setResolvingPick(null)
    }
  }

  // Resolve a controller preload request through the same path as a quick-pick.
  // The token guards against re-resolving the same request across re-renders.
  const handledTokenRef = useRef<number | null>(null)
  useEffect(() => {
    if (!preload || preload.token === handledTokenRef.current) return
    handledTokenRef.current = preload.token
    let cancelled = false
    setPreloadingName(preload.name)
    ;(async () => {
      try {
        const result = await searchPlayer(preload.name)
        if (!cancelled && result) {
          await confirmPlayer(result)
        }
      } finally {
        if (!cancelled) {
          setPreloadingName(null)
          onPreloadHandled?.()
        }
      }
    })()
    return () => {
      cancelled = true
    }
    // confirmPlayer / searchPlayer are stable for this purpose; re-run only when
    // a new preload token arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preload])

  function handleClear() {
    clearSeasons()
    clearSeasonStats()
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
    <div
      className={cn(
        "relative isolate flex flex-col overflow-hidden rounded-sm border bg-card",
        compact ? "min-h-0" : "min-h-[32rem]"
      )}
    >
      {/* A fine printed halftone tone in the player's team color, bleeding from
          the top-right — the same dot treatment as the homepage cover. */}
      {seasonTeamColor && (
        <div
          aria-hidden
          className="halftone-splash pointer-events-none absolute inset-0 -z-10"
          style={
            {
              "--splash-dot": withAlpha(seasonTeamColor, 0.2),
              backgroundImage:
                "radial-gradient(var(--splash-dot) 1.4px, transparent 1.9px)",
              backgroundSize: "9px 9px",
            } as CSSProperties
          }
        />
      )}

      {/* A thin bar of the season team's color tops the card. */}
      {seasonTeamColor && (
        <div className="h-1 w-full" style={{ backgroundColor: seasonTeamColor }} />
      )}

      {/* Slot label, with Clear anchored to the card's top-right once a player
          is selected. */}
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
        <span className="flex items-center gap-2">
          <Kicker tone="muted">
            {label === "Player A" ? "Corner A" : "Corner B"}
          </Kicker>
        </span>
        {profile && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 bg-background/80 px-2.5 font-condensed text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground ring-1 ring-border backdrop-blur-sm hover:bg-muted hover:text-foreground"
            onClick={handleClear}
            aria-label="Clear player"
          >
            Clear
          </Button>
        )}
      </div>

      {profile ? (
        <div className="flex flex-1 flex-col">
          {/* Identity: photo, name, confidence, and the season tag pinned
              top-right in line with the name. The team badge carries its logo. */}
          <div className="flex items-start gap-3 p-4">
            <PlayerAvatar
              playerId={profile.player_id}
              name={profile.name}
              accent={seasonTeamColor}
            />
            <div className="min-w-0 flex-1 space-y-1.5">
              {/* Top row: name (left) + SEASON label (right) */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <h2 className="display text-2xl leading-none">
                    {profile.name}
                  </h2>
                  {confidenceTier && <ConfidenceBadge tier={confidenceTier} />}
                  {profile.data_warnings.length > 0 && (
                    <DataWarningInfo warnings={profile.data_warnings} />
                  )}
                </div>
                <Kicker tone="muted" className="shrink-0">
                  Season
                </Kicker>
              </div>
              {/* Bottom row: position/team badges (left) + selector (right) */}
              <div className="flex items-center justify-between gap-2">
                {/* Position + team as flat, translucent metadata tags — the
                    same tile treatment as the vitals/season chips, so they sit
                    cleanly under the name and stay legible over the dots. */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {profile.position && (
                    <span className="inline-flex items-center rounded-sm bg-background/80 px-2 py-0.5 font-condensed text-[0.7rem] font-bold uppercase tracking-[0.1em] text-muted-foreground ring-1 ring-border backdrop-blur-sm">
                      {profile.position}
                    </span>
                  )}
                  {(seasonTeam ?? profile.team) && (
                    <span className="inline-flex items-center gap-1.5 rounded-sm bg-background/80 px-2 py-0.5 font-condensed text-[0.7rem] font-bold uppercase tracking-[0.1em] text-foreground ring-1 ring-border backdrop-blur-sm">
                      {seasonTeamLogo && (
                        <img
                          src={seasonTeamLogo}
                          alt=""
                          onError={(event) => {
                            event.currentTarget.style.display = "none"
                          }}
                          className="h-4 w-4 object-contain"
                        />
                      )}
                      {seasonTeam ?? profile.team}
                    </span>
                  )}
                </div>
                <SeasonSelector
                  label={label}
                  seasons={seasons}
                  value={selectedSeason}
                  loading={seasonsLoading}
                  onChange={handleSeasonChange}
                />
              </div>
              {seasonsError && (
                <p className="text-xs text-destructive">{seasonsError}</p>
              )}
            </div>
          </div>

          {/* Vitals + season averages — the heavy body, hidden in compact
              (results) mode so only the identity header + season stay visible. */}
          {!compact && (
            <>
              {/* Vitals — translucent tiles, labelled in words */}
              <div className="grid grid-cols-3 gap-2 px-4 pb-3">
                <VitalTile
                  icon={Ruler}
                  label="Height"
                  value={profile.height ?? "N/A"}
                />
                <VitalTile
                  icon={Weight}
                  label="Weight"
                  value={formatWeight(profile.weight)}
                />
                <VitalTile
                  icon={MoveHorizontal}
                  label="Wingspan"
                  value={formatWingspan(profile.wingspan)}
                />
              </div>

              {/* Season averages */}
              <div className="px-4 pb-4">
                <SeasonStatsBody
                  selectedSeason={selectedSeason}
                  stats={seasonStats}
                  loading={seasonStatsLoading}
                  error={seasonStatsError}
                  teamColor={seasonTeamColor}
                />
              </div>
            </>
          )}
        </div>
      ) : preloadingName ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <div className="space-y-1">
            <Kicker tone="muted">Stepping on the court</Kicker>
            <p className="display text-xl leading-none">{preloadingName}</p>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-3 p-4">
          {/* Top half: click-to-open search combobox (backend-ranked,
              keyboard-navigable). */}
          <PlayerSearchCombobox
            onSelect={confirmPlayer}
            align="center"
            contentClassName="w-[min(20rem,var(--radix-popover-trigger-width))]"
            trigger={
              <button
                type="button"
                aria-label={`Select ${label}`}
                className="flex flex-1 flex-col items-center justify-center gap-2 rounded-sm border border-dashed font-condensed text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:border-solid hover:border-primary/40 hover:bg-muted/50"
              >
                <UserRound className="h-8 w-8 opacity-40" />
                Select {label}
              </button>
            }
          />
          {/* Bottom half: one-click recommendations as a grid of headshot
              tiles — same confirm flow as a typed pick, just pre-named. */}
          <div className="flex flex-1 flex-col gap-2.5">
            <Kicker tone="muted" className="flex items-center gap-1.5">
              <Sparkles className="h-3 w-3" />
              Quick Picks
            </Kicker>
            <div className="grid flex-1 grid-cols-3 content-start gap-2">
              {quickPicks.map((pick) => (
                <QuickPickTile
                  key={pick.id}
                  pick={pick}
                  resolving={resolvingPick === pick.name}
                  disabled={resolvingPick !== null}
                  onSelect={() => quickPick(pick.name)}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// A one-click recommendation tile, using the same translucent tile treatment as
// the vitals/stat tiles so it reads as part of the card, not a separate widget.
function QuickPickTile({
  pick,
  resolving,
  disabled,
  onSelect,
}: {
  pick: QuickPick
  resolving: boolean
  disabled: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      aria-label={`Quick pick ${pick.name}`}
      className="group/qp flex flex-col items-center gap-1.5 rounded-sm bg-background/70 p-2 text-center ring-1 ring-border transition-all hover:-translate-y-0.5 hover:bg-muted/50 hover:ring-primary disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:bg-background/70 disabled:hover:ring-border"
    >
      <div className="relative">
        <HalftoneAvatar
          src={`https://cdn.nba.com/headshots/nba/latest/1040x760/${pick.id}.png`}
          alt={pick.name}
          fallback={getInitials(pick.name)}
          size={44}
        />
        {resolving && (
          <span className="absolute inset-0 flex items-center justify-center rounded-sm bg-background/70">
            <Loader2 className="h-4 w-4 animate-spin" />
          </span>
        )}
      </div>
      <span className="line-clamp-2 font-display text-xs font-bold leading-tight">
        {pick.name}
      </span>
    </button>
  )
}

// The season tag IS the selector: it shows the active season and opens the
// season list on click, so there's a single season control (no separate badge).
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
    <Select
      value={value ?? undefined}
      onValueChange={onChange}
      disabled={loading || seasons.length === 0}
    >
      <SelectTrigger
        aria-label={`Select season for ${label}`}
        className="h-auto w-fit gap-1.5 rounded-sm border-0 bg-background/70 px-3 py-1 font-condensed text-xs font-bold uppercase tracking-[0.14em] tabular-nums ring-1 ring-border focus-visible:ring-2"
      >
        <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
        <SelectValue
          placeholder={loading ? "Loading seasons…" : "Select a season"}
        />
      </SelectTrigger>
      <SelectContent position="popper" side="bottom" sideOffset={6} className="max-h-64">
        {seasons.map((season) => (
          <SelectItem key={season.season_id} value={season.season_id}>
            {season.season_label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// The season averages portion of the player card: the headline scoring number
// The per-game averages for the selected season, shown as soft translucent
// tiles (the team-color card tint reads through them). The surrounding card
// chrome — identity, vitals, season tag — is composed in PlayerSlot.
// Per-stat ceilings used to scale the bars. These are "elite season" tops, so
// a star fills most of the bar and a role player reads clearly shorter.
const STAT_BAR_MAX = {
  PTS: 36,
  REB: 15,
  AST: 12,
  FGA: 28,
  BLK: 4,
  STL: 3.5,
} as const

function SeasonStatsBody({
  selectedSeason,
  stats,
  loading,
  error,
  teamColor,
}: {
  selectedSeason: string | null
  stats: PlayerSeasonStats | null
  loading: boolean
  error: string | null
  teamColor: string | null
}) {
  if (!selectedSeason) {
    return (
      <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
        Select a season to view that year's stats.
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-destructive">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        {error}
      </div>
    )
  }

  if (loading || !stats) {
    return (
      <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading {selectedSeason} stats…
      </div>
    )
  }

  // A horizontal bar per stat, filled in the team's color and scaled to its
  // ceiling — the same translucent, length-encodes-magnitude idea as the shot
  // map, so the player's statistical shape reads at a glance.
  const bars = [
    { label: "PTS", value: stats.points_per_game, max: STAT_BAR_MAX.PTS },
    { label: "REB", value: stats.rebound_per_game, max: STAT_BAR_MAX.REB },
    { label: "AST", value: stats.assist_per_game, max: STAT_BAR_MAX.AST },
    { label: "FGA", value: stats.fga_per_game, max: STAT_BAR_MAX.FGA },
    { label: "BLK", value: stats.block_per_game, max: STAT_BAR_MAX.BLK },
    { label: "STL", value: stats.steal_per_game, max: STAT_BAR_MAX.STL },
  ]

  return (
    <div className="space-y-3.5 rounded-sm bg-background/60 p-4 ring-1 ring-border">
      {bars.map((bar) => (
        <StatBar
          key={bar.label}
          label={bar.label}
          value={bar.value}
          max={bar.max}
          color={teamColor}
        />
      ))}
    </div>
  )
}

function StatBar({
  label,
  value,
  max,
  color,
}: {
  label: string
  value: number
  max: number
  color: string | null
}) {
  // Floor at a sliver so a near-zero stat is still visibly a (tiny) bar.
  const fraction = Math.max(0.03, Math.min(1, value / max))
  return (
    <div className="flex items-center gap-3">
      <span className="w-8 shrink-0 kicker text-muted-foreground">
        {label}
      </span>
      <div className="h-3 flex-1 overflow-hidden rounded-[1px] bg-foreground/10">
        <div
          className="h-full rounded-[1px] transition-[width] duration-500"
          style={{
            width: `${fraction * 100}%`,
            backgroundColor: color ? withAlpha(color, 0.85) : "var(--primary)",
          }}
        />
      </div>
      <span className="w-9 shrink-0 text-right font-display text-sm font-bold tabular-nums">
        {value.toFixed(1)}
      </span>
    </div>
  )
}

// Translucent vitals tile with a word label (icons alone read as unclear).
function VitalTile({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Ruler
  label: string
  value: string
}) {
  return (
    <div className="rounded-sm bg-background/70 px-3 py-2.5 ring-1 ring-border">
      <div className="flex items-center gap-1.5 kicker text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-0.5 font-display text-base font-bold tabular-nums">
        {value}
      </div>
    </div>
  )
}

// Shared translucent stat tile, matching the shot-map chip treatment.
function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-sm bg-background/70 px-2 py-2.5 text-center ring-1 ring-border">
      <div className="stat-figure text-2xl leading-none">
        {value}
      </div>
      <div className="mt-1 kicker text-muted-foreground">
        {label}
      </div>
    </div>
  )
}

function PlayerAvatar({
  playerId,
  name,
  accent,
  className,
}: {
  playerId: number
  name: string
  accent?: string | null
  className?: string
}) {
  return (
    <HalftoneAvatar
      src={`https://cdn.nba.com/headshots/nba/latest/1040x760/${playerId}.png`}
      alt={name}
      fallback={getInitials(name)}
      size={56}
      active
      accent={accent ?? undefined}
      className={cn("shrink-0", className)}
    />
  )
}

type PillTone = "brand" | "success" | "warning" | "danger" | "neutral"

const PILL_TONES: Record<PillTone, string> = {
  brand: "border-primary/20 bg-primary/10 text-primary",
  success: "border-primary/20 bg-primary/10 text-primary",
  warning: "border-primary/20 bg-primary/10 text-primary",
  danger: "border-border bg-muted text-muted-foreground",
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
      className={cn(
        "gap-1.5 kicker",
        PILL_TONES[tone],
        className
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </Badge>
  )
}

const CONFIDENCE_LABELS: Record<ConfidenceTier, string> = {
  HIGH: "Verified",
  MEDIUM: "On Record",
  LOW: "Estimated",
}

function ConfidenceBadge({ tier }: { tier: ConfidenceTier }) {
  const tone: PillTone =
    tier === "HIGH" ? "success" : tier === "MEDIUM" ? "warning" : "danger"
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="cursor-default">
          <Pill tone={tone} dot>
            {CONFIDENCE_LABELS[tier]}
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
      <div className="flex items-center gap-1.5">
        <Kicker tone="muted">Possession</Kicker>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              tabIndex={0}
              aria-label="What do Winners and Losers mean?"
              className="inline-flex cursor-default rounded-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <Info className="h-3.5 w-3.5" />
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            Who gets the ball after a bucket — hover a mode for details.
          </TooltipContent>
        </Tooltip>
      </div>
      <div
        role="radiogroup"
        aria-label="Possession mode"
        className="inline-flex rounded-sm border bg-muted/40 p-0.5"
      >
        {POSSESSION_MODES.map((mode) => {
          const Icon = mode.icon
          const active = value === mode.value
          return (
            <Tooltip key={mode.value}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={`${mode.label} — ${mode.hint}`}
                  disabled={disabled}
                  onClick={() => onChange(mode.value)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-sm px-4 py-1.5 font-condensed text-xs font-bold uppercase tracking-[0.14em] transition-colors",
                    "disabled:cursor-not-allowed disabled:opacity-50",
                    active
                      ? "bg-background text-primary shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {mode.label}
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">{mode.hint}</TooltipContent>
            </Tooltip>
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
  const aWins = result.player_a_win_pct >= result.player_b_win_pct
  const favoriteName = aWins ? playerA.name : playerB.name
  const favoritePct = aWins
    ? result.player_a_win_pct
    : result.player_b_win_pct
  const verdict = verdictHeadline(favoriteName, favoritePct)
  return (
    <Card className="mt-6 rounded-sm border-2 border-primary/30 shadow-sm ring-1 ring-primary/10">
      <CardHeader className="space-y-1.5">
        <Kicker ruled>
          The Verdict — {result.total_simulations.toLocaleString()} Simulations
        </Kicker>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Verdict headline on a faint halftone field — the dominant headline of
            the results; the single-game Game Story below is secondary. */}
        <div className="relative flex items-center justify-center overflow-hidden rounded-sm border px-4 py-8 sm:py-10">
          <span className="halftone pointer-events-none absolute inset-0 opacity-50" aria-hidden />
          <h3 className="relative display text-center text-4xl sm:text-5xl">
            {verdict}
          </h3>
        </div>
        <div className="flex items-center justify-between kicker">
          <span
            className={cn(
              "truncate",
              aWins ? "text-primary" : "text-muted-foreground"
            )}
          >
            {playerA.name}
          </span>
          <span className="shrink-0 px-2 text-muted-foreground">
            Win probability
          </span>
          <span
            className={cn(
              "truncate text-right",
              !aWins ? "text-primary" : "text-muted-foreground"
            )}
          >
            {playerB.name}
          </span>
        </div>
        <div className="flex h-3 overflow-hidden rounded-[1px] bg-muted">
          <div
            className={cn("h-full", aWins ? "bg-primary" : "bg-foreground/35")}
            style={{ width: `${result.player_a_win_pct}%` }}
          />
          {!aWins && (
            <div
              className="h-full bg-primary"
              style={{ width: `${result.player_b_win_pct}%` }}
            />
          )}
        </div>
        <div className="flex items-center justify-between stat-figure text-4xl sm:text-5xl">
          <span className={aWins ? "text-primary" : "text-muted-foreground"}>
            {Math.round(result.player_a_win_pct)}%
          </span>
          <span className={!aWins ? "text-primary" : "text-muted-foreground"}>
            {Math.round(result.player_b_win_pct)}%
          </span>
        </div>
        <p className="pt-1 kicker text-muted-foreground">
          {playerA.name} won{" "}
          <span className="tabular-nums text-foreground">
            {result.player_a_wins.toLocaleString()}
          </span>
          , {playerB.name} won{" "}
          <span className="tabular-nums text-foreground">
            {result.player_b_wins.toLocaleString()}
          </span>
          {result.ties > 0 && (
            <>
              ,{" "}
              <span className="tabular-nums text-foreground">
                {result.ties.toLocaleString()}
              </span>{" "}
              ties
            </>
          )}
          .
        </p>
      </CardContent>
    </Card>
  )
}

// Compact, non-disruptive surfacing of data limitations: a small red info "i"
// that reveals the warning text(s) on hover/focus, replacing the old full-width
// alert box. Keyboard-focusable for accessibility.
function DataWarningInfo({
  warnings,
  className,
}: {
  warnings: string[]
  className?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          aria-label="Data limitations"
          className={cn(
            "inline-flex cursor-default text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40 rounded-sm",
            className
          )}
        >
          <Info className="h-4 w-4" />
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <span className="block font-condensed text-xs font-bold uppercase tracking-[0.14em]">
          Data limitations
        </span>
        <ul className="mt-1 list-disc space-y-1 pl-4">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  )
}

// Exported so the GOAT Bracket series drill-down can render the same match
// summary per game. `onRerun` is optional — the bracket has no re-run action, so
// the button is hidden there.
export function MatchSummaryView({
  summary,
  playerAName,
  playerBName,
  onRerun,
  rerunDisabled,
}: {
  summary: MatchSummary
  playerAName: string
  playerBName: string
  onRerun?: () => void
  rerunDisabled?: boolean
}) {
  const aWon = summary.final_score.a >= summary.final_score.b
  return (
    <Card className="rounded-sm">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Kicker ruled>The Game Story</Kicker>
          {summary.data_warnings.length > 0 && (
            <DataWarningInfo warnings={summary.data_warnings} />
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <div className="text-center">
            <Kicker tone="muted">Final</Kicker>
          </div>
          <div className="divide-y overflow-hidden rounded-sm border">
            <ScoreRow
              name={playerAName}
              score={summary.final_score.a}
              winner={aWon}
            />
            <ScoreRow
              name={playerBName}
              score={summary.final_score.b}
              winner={!aWon}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {Object.entries(summary.player_stats).map(([playerName, stats]) => (
            <PlayerStatsSummary
              key={playerName}
              playerName={playerName}
              stats={stats}
            />
          ))}
        </div>

        {onRerun && (
          <Button
            variant="outline"
            className="w-full font-condensed font-bold uppercase tracking-[0.14em]"
            onClick={onRerun}
            disabled={rerunDisabled}
          >
            {rerunDisabled ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RotateCcw className="h-4 w-4" />
            )}
            Run it back
          </Button>
        )}
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
        winner ? "bg-primary/5" : "bg-muted/20"
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={cn(
            "truncate display text-lg leading-none",
            winner && "text-primary"
          )}
        >
          {name}
        </span>
        {winner && (
          <Badge className="kicker">
            Winner
          </Badge>
        )}
      </div>
      <span
        className={cn(
          "stat-figure text-3xl",
          winner ? "text-primary" : "text-muted-foreground"
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
    <div className="space-y-4 rounded-sm border p-4">
      <div className="display text-lg leading-none">
        {playerName}
      </div>

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

      <div className="flex items-center gap-4 border-t pt-3 kicker text-muted-foreground">
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

type ShotCounts = { rim: number; mid_range: number; three: number }

// Per-zone shooting-efficiency grading. Thresholds are zone-specific because a
// good three (~37%) and a good rim finish (~60%) sit at very different rates.
const ZONE_THRESHOLDS: Record<keyof ShotCounts, { ok: number; good: number }> = {
  rim: { ok: 0.45, good: 0.6 },
  mid_range: { ok: 0.33, good: 0.42 },
  three: { ok: 0.3, good: 0.37 },
}

// Traffic-light efficiency grade — muted, print-friendly tones so it reads as
// a newspaper stat graphic, not neon: hot zones go basil green, ok zones a
// warm ochre, cold zones brick red, and empty zones a faint muted ink.
const ZONE_COLORS = {
  good: { fill: "rgba(74,140,82,0.32)", stroke: "rgba(74,140,82,0.66)" },
  ok: { fill: "rgba(196,150,46,0.32)", stroke: "rgba(196,150,46,0.70)" },
  poor: { fill: "rgba(198,72,50,0.30)", stroke: "rgba(198,72,50,0.64)" },
  none: { fill: "rgba(120,113,108,0.10)", stroke: "rgba(120,113,108,0.30)" },
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
        <Kicker tone="muted">Shot Map</Kicker>
        <span className="font-condensed text-xs font-bold uppercase tracking-[0.14em] tabular-nums text-muted-foreground">
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

        {/* A faint halftone screen over the zones — gives the colored areas a
            printed, dotted texture rather than a flat digital fill. */}
        <span
          aria-hidden
          className="halftone halftone-fade pointer-events-none absolute inset-0 opacity-40"
        />

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
      className="absolute left-1/2 flex -translate-x-1/2 -translate-y-1/2 items-baseline gap-1 rounded-sm bg-background/90 px-2 py-0.5 font-condensed text-xs font-bold uppercase tracking-[0.1em] shadow-sm ring-1 ring-border"
    >
      <span>{label}</span>
      <span className="tabular-nums">
        {attempts ? `${Math.round(pct * 100)}%` : "—"}
      </span>
      <span className="tabular-nums text-muted-foreground">({attempts})</span>
    </span>
  )
}

// A possession enriched with the duel context we visualize: which side shot,
// the running lead, whether the lead just flipped, and any scoring-run milestone.
interface EnrichedPlay {
  play: PlayByPlay
  side: "a" | "b"
  margin: number
  leadChange: boolean
  runSide: "a" | "b" | null
  runCallout: number | null
}

// Figure out which player name is "A" vs "B" purely from score deltas:
// score_a only grows on A's makes. Explicit name hints win; the complement
// covers a player who never scored. Keeps the bracket caller prop-free.
function resolveSides(plays: PlayByPlay[], hintA?: string, hintB?: string) {
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

function enrichPlays(plays: PlayByPlay[], nameA: string): EnrichedPlay[] {
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

// Exported for reuse by the GOAT Bracket series drill-down. playerA/playerB are
// optional name hints; without them the sides are inferred from the score.
export function PlayByPlayView({
  playByPlay,
  playerA,
  playerB,
}: {
  playByPlay: PlayByPlay[]
  playerA?: string
  playerB?: string
}) {
  const { nameA, nameB } = useMemo(
    () => resolveSides(playByPlay, playerA, playerB),
    [playByPlay, playerA, playerB]
  )
  const enriched = useMemo(
    () => enrichPlays(playByPlay, nameA),
    [playByPlay, nameA]
  )
  const last = enriched[enriched.length - 1]
  const margin = last ? last.margin : 0
  const leader = margin > 0 ? nameA : margin < 0 ? nameB : null

  return (
    <Card className="flex flex-col rounded-sm">
      <CardHeader className="space-y-0 pb-3">
        <Kicker ruled>The Running Diary</Kicker>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
        {enriched.length > 0 && (
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <Kicker tone="muted">Who's Ahead</Kicker>
              <span className="kicker tabular-nums">
                {leader ? (
                  <>
                    <span className="text-primary">{leader}</span>{" "}
                    +{Math.abs(margin)}
                  </>
                ) : (
                  <span className="text-muted-foreground">Tied</span>
                )}
              </span>
            </div>
            <MarginSparkline enriched={enriched} />
          </div>
        )}

        <div className="scrollbar-hide min-h-[20rem] flex-1 overflow-y-auto xl:min-h-0">
          {/* Sticky lane labels: who's on the left vs right of the duel. */}
          <div className="sticky top-0 z-10 grid grid-cols-[1fr_auto_1fr] items-center border-b bg-card/95 backdrop-blur">
            <span className="block truncate py-2 pr-3 text-right font-condensed text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
              {nameA}
            </span>
            <span className="block min-w-[4.5rem] px-3 py-2 text-center font-condensed text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground/70">
              Score
            </span>
            <span className="block truncate py-2 pl-3 text-left font-condensed text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
              {nameB}
            </span>
          </div>

          {enriched.map((e, i) => (
            <Fragment key={e.play.possession}>
              <PossessionRow e={e} index={i} />
              {e.leadChange && <LeadChangeDivider />}
              {e.runCallout != null && (
                <RunBanner
                  name={e.runSide === "a" ? nameA : nameB}
                  points={e.runCallout}
                />
              )}
            </Fragment>
          ))}

          {enriched.length === 0 && (
            <div className="flex min-h-[20rem] items-center justify-center font-condensed text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
              No plays to show
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// Lead margin (score_a - score_b) over the game: vermillion above the
// centerline when A is ahead, neutral below when B is ahead. Pure inline SVG.
function MarginSparkline({ enriched }: { enriched: EnrichedPlay[] }) {
  const clipId = useId()
  const W = 600
  const H = 56
  const mid = H / 2
  const maxM = 21
  const n = enriched.length
  const xOf = (i: number) => (n <= 1 ? W / 2 : (i / (n - 1)) * W)
  const yOf = (m: number) =>
    mid - (Math.max(-maxM, Math.min(maxM, m)) / maxM) * (mid - 3)
  const line = enriched.map((e, i) => `${xOf(i)},${yOf(e.margin)}`).join(" ")
  const area =
    `M ${xOf(0)},${mid} ` +
    enriched.map((e, i) => `L ${xOf(i)},${yOf(e.margin)}`).join(" ") +
    ` L ${xOf(n - 1)},${mid} Z`
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="h-12 w-full"
      aria-hidden
    >
      <defs>
        <clipPath id={`${clipId}-t`}>
          <rect x="0" y="0" width={W} height={mid} />
        </clipPath>
        <clipPath id={`${clipId}-b`}>
          <rect x="0" y={mid} width={W} height={mid} />
        </clipPath>
      </defs>
      <path
        d={area}
        className="fill-primary/20"
        clipPath={`url(#${clipId}-t)`}
      />
      <path
        d={area}
        className="fill-foreground/[0.06]"
        clipPath={`url(#${clipId}-b)`}
      />
      <line
        x1="0"
        y1={mid}
        x2={W}
        y2={mid}
        className="stroke-border"
        strokeDasharray="3 4"
      />
      <polyline
        points={line}
        fill="none"
        className="stroke-primary"
        strokeWidth="1.5"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

function PossessionRow({ e, index }: { e: EnrichedPlay; index: number }) {
  const { play, side } = e
  const isA = side === "a"
  const made = play.result === "made" && !play.turnover
  const dotClass = play.turnover
    ? "bg-foreground/40"
    : made
      ? "bg-primary"
      : play.foul
        ? "bg-primary/50"
        : "border border-muted-foreground/40"
  const detail = play.turnover
    ? "Turnover"
    : play.foul
      ? "Drew a foul"
      : `${formatShotType(play.shot_type)} · ${made ? "Made" : "Missed"}`

  const content = (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-1",
        isA ? "items-end text-right" : "items-start text-left"
      )}
    >
      <span className="max-w-full truncate display text-sm leading-none">
        {play.offensive_player}
      </span>
      <span
        className={cn(
          "flex items-center gap-1.5 font-condensed text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground",
          isA && "flex-row-reverse"
        )}
      >
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotClass)} />
        <span className="truncate">{detail}</span>
      </span>
    </div>
  )

  return (
    <div
      className={cn(
        "grid grid-cols-[1fr_auto_1fr] items-stretch animate-in fade-in slide-in-from-bottom-1 duration-300 [animation-fill-mode:both]",
        index > 0 && "border-t border-border/60"
      )}
      style={{ animationDelay: `${Math.min(index * 18, 360)}ms` }}
    >
      <div
        className={cn(
          "flex items-center justify-end py-2.5 pr-3",
          made && isA && "border-r-2 border-primary"
        )}
      >
        {isA ? content : null}
      </div>
      <div className="flex min-w-[4.5rem] flex-col items-center justify-center gap-0.5 border-x border-border/60 bg-muted/20 px-3 py-2">
        <span className="flex items-baseline gap-1 font-display text-lg font-black tabular-nums leading-none">
          <span className={play.score_a > play.score_b ? "text-primary" : ""}>
            {play.score_a}
          </span>
          <span className="text-xs text-muted-foreground">–</span>
          <span className={play.score_b > play.score_a ? "text-primary" : ""}>
            {play.score_b}
          </span>
        </span>
        <span className="kicker text-muted-foreground tabular-nums">
          {play.score_a === play.score_b
            ? "Tied"
            : `+${Math.abs(play.score_a - play.score_b)}`}
        </span>
      </div>
      <div
        className={cn(
          "flex items-center justify-start py-2.5 pl-3",
          made && !isA && "border-l-2 border-primary"
        )}
      >
        {!isA ? content : null}
      </div>
    </div>
  )
}

function LeadChangeDivider() {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5">
      <div className="h-px flex-1 bg-primary/30" />
      <span className="kicker text-primary">
        Lead Changes Hands
      </span>
      <div className="h-px flex-1 bg-primary/30" />
    </div>
  )
}

function RunBanner({ name, points }: { name: string; points: number }) {
  return (
    <div className="my-1 flex items-center justify-center gap-2 rounded-sm border border-primary/30 bg-primary/10 px-3 py-1.5">
      <span className="display text-sm text-primary">
        {name}
      </span>
      <span className="kicker tabular-nums text-primary/80">
        {points}-0 run
      </span>
    </div>
  )
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

// Spells out exactly what is still missing so a disabled "Run game" button is
// never a mystery: a player can be picked but still need a season selected.
function runRequirementHint(
  playerA: PlayerProfile | null,
  playerB: PlayerProfile | null,
  seasonA: string | null,
  seasonB: string | null
): string {
  const missing: string[] = []
  if (!playerA) missing.push("select Player A")
  else if (!seasonA) missing.push("choose Player A's season")
  if (!playerB) missing.push("select Player B")
  else if (!seasonB) missing.push("choose Player B's season")

  if (missing.length === 0) {
    return "Ready to simulate."
  }
  return `To run a simulation, ${joinWithAnd(missing)}.`
}

function joinWithAnd(items: string[]): string {
  if (items.length <= 1) return items.join("")
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`
}

function formatPct(value: number) {
  return `${(value * 100).toFixed(1)}%`
}

function lastNameOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return parts[parts.length - 1] ?? name
}

// The editorial verdict line above the win-probability bar, scaled to how
// lopsided the favorite's win rate is.
function verdictHeadline(favoriteName: string, favoritePct: number): string {
  const last = lastNameOf(favoriteName)
  if (favoritePct >= 80) return "It Isn't Close."
  if (favoritePct >= 65) return `${last} Has the Edge.`
  if (favoritePct >= 55) return `${last}, Narrowly.`
  return "Too Close to Call."
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

  // No seed is sent, so each game is independently random server-side and the
  // batch differs run to run (mirrors the bulk endpoint's fresh-RNG behavior).
  for (let game = 0; game < BULK_SIM_COUNT; game++) {
    const response = await axios.post<SimulationResult>(
      `${API_BASE_URL}/simulate`,
      {
        player_a_id: playerAId,
        player_b_id: playerBId,
        season_a_id: seasonAId,
        season_b_id: seasonBId,
        possession_mode: possessionMode,
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
