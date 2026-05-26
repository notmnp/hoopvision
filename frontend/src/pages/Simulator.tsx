import { CSSProperties, ReactNode, useEffect, useState } from "react"
import axios from "axios"
import { API_BASE_URL } from "@/lib/config"
import {
  AlertTriangle,
  CalendarDays,
  Loader2,
  MoveHorizontal,
  Percent,
  Repeat,
  RotateCcw,
  Ruler,
  Shuffle,
  Sparkles,
  Swords,
  Trophy,
  UserRound,
  Weight,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { getTeamColor, getTeamLogoUrl, withAlpha } from "@/lib/teamColors"
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
import { PlayerSearchCombobox } from "@/components/PlayerSearchCombobox"
import { Progress } from "@/components/ui/progress"
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
    hint: "Scorer keeps the ball",
    icon: Repeat,
  },
  {
    value: "alternating",
    label: "Losers",
    hint: "Ball changes hands every possession",
    icon: Shuffle,
  },
]

const CONFIDENCE_TOOLTIPS: Record<ConfidenceTier, string> = {
  HIGH: "HIGH confidence: sufficient matchup tracking data available for this player.",
  MEDIUM:
    "MEDIUM confidence: post-tracking era player with limited observed data.",
  LOW: "LOW confidence: pre-tracking era or statistical outlier — model-generalized profile.",
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

interface PlayerSlotProps {
  label: SlotLabel
  selectedPlayer: PlayerProfile | null
  selectedSeason: string | null
  onSelect: (player: PlayerProfile) => void
  onClear: () => void
  onSeasonSelect: (seasonId: string | null) => void
  onSeasonStatsChange?: (stats: PlayerSeasonStats | null) => void
  confidenceTier?: ConfidenceTier | null
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
          <div className="text-sm font-medium text-muted-foreground">
            IsoLab
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
            <Tooltip>
              <TooltipTrigger asChild>
                {/* Wrapped in a span so the tooltip still fires while the
                    button is disabled (disabled controls emit no hover). */}
                <span className="flex w-full sm:w-auto">
                  <Button
                    disabled={!canRunSimulation || busy}
                    className="w-full sm:w-auto"
                    onClick={runSimulation}
                  >
                    {simulationLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Swords className="h-4 w-4" />
                    )}
                    {simulationResult ? "Re-run game" : "Run game"}
                  </Button>
                </span>
              </TooltipTrigger>
              {!canRunSimulation && (
                <TooltipContent>
                  {runRequirementHint(playerA, playerB, seasonA, seasonB)}
                </TooltipContent>
              )}
            </Tooltip>
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
              {bulkLoading ? "Running 1,000…" : "Run 1,000 games"}
            </Button>
          </div>
        </div>
      </div>

      <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-[1fr_auto_1fr] lg:items-start">
        <PlayerSlot
          label="Player A"
          selectedPlayer={playerA}
          selectedSeason={seasonA}
          onSelect={selectPlayerA}
          onClear={() => selectPlayerA(null)}
          onSeasonSelect={selectSeasonA}
          onSeasonStatsChange={setSeasonStatsA}
          confidenceTier={
            playerA
              ? simulationResult?.summary.player_stats[playerA.name]
                  ?.confidence_tier ?? null
              : null
          }
        />
        <div className="hidden h-full items-center justify-center lg:flex">
          <div className="-mt-4 flex h-12 w-12 items-center justify-center rounded-full border bg-muted text-sm font-semibold text-muted-foreground">
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
          onSeasonStatsChange={setSeasonStatsB}
          confidenceTier={
            playerB
              ? simulationResult?.summary.player_stats[playerB.name]
                  ?.confidence_tier ?? null
              : null
          }
        />
      </div>

      {/* Tendency Explorer comparison panel: appears automatically once both
          players and seasons are confirmed and their season stats have loaded,
          below the player cards and ahead of the simulation results. The
          season_id guard avoids rendering against a previous season's stats
          while a newly selected season is still loading. */}
      {playerA &&
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
        <div className="mt-6 grid gap-4 xl:grid-cols-[24rem_1fr]">
          <MatchSummaryView
            summary={simulationResult.summary}
            playerAName={playerA.name}
            playerBName={playerB.name}
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
  onSeasonStatsChange,
  confidenceTier,
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
      className="flex min-h-[32rem] flex-col overflow-hidden rounded-lg border bg-card shadow-sm"
      style={
        seasonTeamColor
          ? {
              backgroundImage: `linear-gradient(to bottom right, ${withAlpha(
                seasonTeamColor,
                0.16
              )}, transparent 60%)`,
            }
          : undefined
      }
    >
      {/* A thin bar of the season team's color tops the card. */}
      {seasonTeamColor && (
        <div className="h-1 w-full" style={{ backgroundColor: seasonTeamColor }} />
      )}

      {/* Slot label, with Clear anchored to the card's top-right once a player
          is selected. */}
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
        <span className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <UserRound className="h-4 w-4" />
          {label}
        </span>
        {profile && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-muted-foreground"
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
            <PlayerAvatar playerId={profile.player_id} name={profile.name} />
            <div className="min-w-0 flex-1 space-y-1.5">
              {/* Top row: name (left) + SEASON label (right) */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <h2 className="text-xl font-semibold leading-tight">
                    {profile.name}
                  </h2>
                  {confidenceTier && <ConfidenceBadge tier={confidenceTier} />}
                </div>
                <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Season
                </span>
              </div>
              {/* Bottom row: position/team badges (left) + selector (right) */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1.5">
                  {profile.position && <Badge>{profile.position}</Badge>}
                  {(seasonTeam ?? profile.team) && (
                    <Badge variant="secondary" className="gap-1.5 pl-1.5">
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
                    </Badge>
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

          {profile.data_warnings.length > 0 && (
            <div className="px-4 pb-4">
              <WarningAlert warnings={profile.data_warnings} />
            </div>
          )}
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
                className="flex flex-1 flex-col items-center justify-center gap-2 rounded-md border border-dashed text-sm text-muted-foreground transition-colors hover:border-solid hover:bg-muted/50"
              >
                <UserRound className="h-8 w-8 opacity-40" />
                Select {label}
              </button>
            }
          />
          {/* Bottom half: one-click recommendations as a grid of headshot
              tiles — same confirm flow as a typed pick, just pre-named. */}
          <div className="flex flex-1 flex-col gap-2.5">
            <span className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              <Sparkles className="h-3 w-3" />
              Quick picks
            </span>
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
      className="flex flex-col items-center gap-1.5 rounded-md bg-background/70 p-2 text-center shadow-sm ring-1 ring-border transition-colors hover:bg-muted/50 disabled:opacity-50 disabled:hover:bg-background/70"
    >
      <div className="relative">
        <Avatar className="h-11 w-11 rounded-md border bg-muted">
          <AvatarImage
            src={`https://cdn.nba.com/headshots/nba/latest/1040x760/${pick.id}.png`}
            alt={pick.name}
            className="object-cover object-top"
          />
          <AvatarFallback className="rounded-md text-xs font-semibold">
            {getInitials(pick.name)}
          </AvatarFallback>
        </Avatar>
        {resolving && (
          <span className="absolute inset-0 flex items-center justify-center rounded-md bg-background/70">
            <Loader2 className="h-4 w-4 animate-spin" />
          </span>
        )}
      </div>
      <span className="line-clamp-2 text-[11px] font-medium leading-tight">
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
        className="h-auto w-fit gap-1.5 rounded-full border-0 bg-background/70 px-3 py-1 text-xs font-medium shadow-sm ring-1 ring-border focus-visible:ring-2"
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
    <div className="space-y-3.5 rounded-md bg-background/60 p-4 shadow-sm ring-1 ring-border">
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
      <span className="w-8 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <div className="h-3 flex-1 overflow-hidden rounded-full bg-foreground/10">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{
            width: `${fraction * 100}%`,
            backgroundColor: color ? withAlpha(color, 0.85) : "var(--primary)",
          }}
        />
      </div>
      <span className="w-9 shrink-0 text-right text-sm font-semibold tabular-nums">
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
    <div className="rounded-md bg-background/70 px-3 py-2.5 shadow-sm ring-1 ring-border">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums">{value}</div>
    </div>
  )
}

// Shared translucent stat tile, matching the shot-map chip treatment.
function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-background/70 px-2 py-2.5 text-center shadow-sm ring-1 ring-border">
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
    </div>
  )
}

function PlayerAvatar({
  playerId,
  name,
  className,
}: {
  playerId: number
  name: string
  className?: string
}) {
  return (
    <Avatar className={cn("h-14 w-14 shrink-0 rounded-md border bg-muted", className)}>
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
              aria-label={`${mode.label} — ${mode.hint}`}
              title={mode.hint}
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

        {onRerun && (
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

// Exported for reuse by the GOAT Bracket series drill-down.
export function PlayByPlayView({ playByPlay }: { playByPlay: PlayByPlay[] }) {
  return (
    <Card className="flex flex-col rounded-lg">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Play-by-play
        </CardTitle>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col">
        <div className="scrollbar-hide min-h-[20rem] flex-1 space-y-2 overflow-y-auto pr-1 xl:min-h-0">
          {playByPlay.map((play) => (
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
