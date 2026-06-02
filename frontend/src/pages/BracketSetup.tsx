import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import axios from "axios"
import {
  AlertTriangle,
  Download,
  Eraser,
  FastForward,
  Loader2,
  PlayCircle,
  Plus,
  Sparkles,
  Swords,
} from "lucide-react"

import { API_BASE_URL } from "@/lib/config"
import {
  BRACKET_SIZES,
  BracketConfig,
  BracketSize,
  BracketSlot,
  BracketState,
  EMPTY_SLOT,
  SERIES_FORMATS,
  SeriesFormat,
  emptySlots,
  isSlotReady,
} from "@/lib/bracket"
import { exportBracketImage } from "@/lib/bracketExporter"
import { cn } from "@/lib/utils"
import { BracketBuilder } from "@/components/BracketBuilder"
import { BracketBoard } from "@/components/BracketBoard"
import { Kicker, Rule } from "@/components/editorial"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

// Curated preset fields. Each entry is [player name, peak season] in seed order
// (index 0 = seed 1). Names resolve through the same /players/search index the
// combobox uses, and the season string is applied directly (no extra lookup),
// so dropping a preset fills the whole field in one request per slot. Lists are
// 16 deep; smaller bracket sizes take the top-N prefix, keeping seeds stable.
interface FieldPreset {
  id: string
  label: string
  blurb: string
  players: [name: string, season: string][]
}

const FIELD_PRESETS: FieldPreset[] = [
  {
    id: "all-time",
    label: "All-Time Top 16",
    blurb: "The undisputed pantheon, peak seasons.",
    players: [
      ["Michael Jordan", "1995-96"],
      ["LeBron James", "2012-13"],
      ["Kareem Abdul-Jabbar", "1971-72"],
      ["Magic Johnson", "1986-87"],
      ["Bill Russell", "1964-65"],
      ["Larry Bird", "1985-86"],
      ["Wilt Chamberlain", "1966-67"],
      ["Tim Duncan", "2002-03"],
      ["Shaquille O'Neal", "1999-00"],
      ["Kobe Bryant", "2005-06"],
      ["Hakeem Olajuwon", "1993-94"],
      ["Stephen Curry", "2015-16"],
      ["Kevin Durant", "2013-14"],
      ["Nikola Jokic", "2023-24"],
      ["Giannis Antetokounmpo", "2019-20"],
      ["Oscar Robertson", "1963-64"],
    ],
  },
  {
    id: "modern",
    label: "Modern Era",
    blurb: "The faces of the post-2010 league.",
    players: [
      ["LeBron James", "2017-18"],
      ["Stephen Curry", "2015-16"],
      ["Kevin Durant", "2013-14"],
      ["Nikola Jokic", "2023-24"],
      ["Giannis Antetokounmpo", "2019-20"],
      ["Luka Doncic", "2023-24"],
      ["Joel Embiid", "2022-23"],
      ["James Harden", "2018-19"],
      ["Kawhi Leonard", "2018-19"],
      ["Russell Westbrook", "2016-17"],
      ["Jayson Tatum", "2023-24"],
      ["Shai Gilgeous-Alexander", "2023-24"],
      ["Damian Lillard", "2022-23"],
      ["Anthony Davis", "2019-20"],
      ["Devin Booker", "2022-23"],
      ["Jimmy Butler", "2022-23"],
    ],
  },
  {
    id: "80s90s",
    label: "80s / 90s Legends",
    blurb: "Hardwood Classics, throwback uniforms.",
    players: [
      ["Michael Jordan", "1995-96"],
      ["Magic Johnson", "1986-87"],
      ["Larry Bird", "1985-86"],
      ["Hakeem Olajuwon", "1993-94"],
      ["Karl Malone", "1996-97"],
      ["Charles Barkley", "1992-93"],
      ["David Robinson", "1994-95"],
      ["Patrick Ewing", "1989-90"],
      ["Isiah Thomas", "1988-89"],
      ["Scottie Pippen", "1993-94"],
      ["John Stockton", "1989-90"],
      ["Clyde Drexler", "1991-92"],
      ["Dominique Wilkins", "1987-88"],
      ["Gary Payton", "1995-96"],
      ["Reggie Miller", "1993-94"],
      ["Kevin Garnett", "2003-04"],
    ],
  },
  {
    id: "guards",
    label: "Guards Only",
    blurb: "Backcourt assassins, no bigs allowed.",
    players: [
      ["Michael Jordan", "1995-96"],
      ["Stephen Curry", "2015-16"],
      ["Magic Johnson", "1986-87"],
      ["Kobe Bryant", "2005-06"],
      ["Luka Doncic", "2023-24"],
      ["James Harden", "2018-19"],
      ["Allen Iverson", "2000-01"],
      ["Russell Westbrook", "2016-17"],
      ["Dwyane Wade", "2008-09"],
      ["Damian Lillard", "2022-23"],
      ["Shai Gilgeous-Alexander", "2023-24"],
      ["Jerry West", "1969-70"],
      ["Oscar Robertson", "1963-64"],
      ["John Stockton", "1989-90"],
      ["Isiah Thomas", "1988-89"],
      ["Gary Payton", "1995-96"],
    ],
  },
  {
    id: "bigs",
    label: "Bigs Only",
    blurb: "Paint enforcers and skilled centers.",
    players: [
      ["Kareem Abdul-Jabbar", "1971-72"],
      ["Wilt Chamberlain", "1966-67"],
      ["Shaquille O'Neal", "1999-00"],
      ["Tim Duncan", "2002-03"],
      ["Hakeem Olajuwon", "1993-94"],
      ["Nikola Jokic", "2023-24"],
      ["Bill Russell", "1964-65"],
      ["Giannis Antetokounmpo", "2019-20"],
      ["David Robinson", "1994-95"],
      ["Kevin Garnett", "2003-04"],
      ["Joel Embiid", "2022-23"],
      ["Patrick Ewing", "1989-90"],
      ["Anthony Davis", "2019-20"],
      ["Karl Malone", "1996-97"],
      ["Dirk Nowitzki", "2006-07"],
      ["Moses Malone", "1982-83"],
    ],
  },
]

// The GOAT Bracket workspace. A bracket is one object with a lifecycle
// (SETUP → IN_PROGRESS → COMPLETE), so a single page owns it across both
// phases: build the field, then — without a page swap — lock it and run. The
// optional :bracketId in the URL only gains a value once the bracket is
// created (via replace), so a refresh re-loads an in-progress bracket while it
// lives in the in-memory session store (ADR-002).
export default function BracketWorkspace() {
  const { bracketId } = useParams<{ bracketId: string }>()
  const navigate = useNavigate()

  // Setup-phase inputs.
  const [size, setSize] = useState<BracketSize>(8)
  const [seriesFormat, setSeriesFormat] = useState<SeriesFormat>(7)
  const [slots, setSlots] = useState<BracketSlot[]>(() => emptySlots(8))

  // Run-phase state plus the various in-flight flags.
  const [bracketState, setBracketState] = useState<BracketState | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingDefault, setLoadingDefault] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [simulating, setSimulating] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [loadingPreset, setLoadingPreset] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const treeRef = useRef<HTMLDivElement>(null)

  const fetchState = useCallback(async (id: string) => {
    try {
      const response = await axios.get<BracketState>(
        `${API_BASE_URL}/bracket/${id}`
      )
      setBracketState(response.data)
    } catch (caught) {
      setError(getBracketError(caught, "Failed to load the bracket."))
    }
  }, [])

  // Resolve the running bracket from the URL. The guard skips the fetch when we
  // already hold that bracket (i.e. we just created it), so clicking Simulate
  // locks the page in place rather than triggering a reload flash.
  useEffect(() => {
    if (!bracketId) {
      setBracketState(null)
      return
    }
    if (bracketState?.bracket_id === bracketId) return
    setLoading(true)
    setError(null)
    fetchState(bracketId).finally(() => setLoading(false))
  }, [bracketId, bracketState?.bracket_id, fetchState])

  function changeSize(nextSize: BracketSize) {
    setSize(nextSize)
    setSlots(emptySlots(nextSize))
    setError(null)
  }

  function updateSlot(index: number, slot: BracketSlot) {
    setSlots((current) => {
      const next = [...current]
      next[index] = slot
      return next
    })
  }

  async function loadPreconfigured() {
    setLoadingDefault(true)
    setError(null)
    try {
      const response = await axios.get<BracketConfig>(
        `${API_BASE_URL}/bracket/default/${size}`
      )
      // The default config carries the player name alongside id + season, so
      // the slots render fully without an extra lookup.
      setSlots(
        response.data.participants.map((participant) => ({
          player_id: participant.player_id,
          name: participant.name ?? null,
          season_id: participant.season_id,
        }))
      )
    } catch (caught) {
      setError(getBracketError(caught, "Failed to load the pre-configured bracket."))
    } finally {
      setLoadingDefault(false)
    }
  }

  // Drop a curated preset field into the slots. Each name is resolved to a
  // player_id through the same search index the combobox uses, then paired with
  // the preset's peak-season string directly — no per-slot season lookup, so a
  // full 16-player field lands fast. Any name that fails to resolve is left
  // empty (and surfaced), so a single miss doesn't blow away the whole drop.
  async function loadPreset(preset: FieldPreset) {
    setLoadingPreset(preset.id)
    setError(null)
    try {
      const picks = preset.players.slice(0, size)
      const resolved = await Promise.all(
        picks.map(async ([name, season_id]) => {
          try {
            const response = await axios.get<{ id: number; full_name: string }[]>(
              `${API_BASE_URL}/players/search`,
              { params: { q: name } }
            )
            const match = response.data[0]
            if (!match) return { ...EMPTY_SLOT }
            return {
              player_id: match.id,
              name: match.full_name,
              season_id,
            } satisfies BracketSlot
          } catch {
            return { ...EMPTY_SLOT }
          }
        })
      )
      setSlots(() => {
        const next = emptySlots(size)
        resolved.forEach((slot, index) => {
          next[index] = slot
        })
        return next
      })
      const missing = resolved.filter((slot) => slot.player_id === null).length
      if (missing > 0) {
        setError(
          `Loaded the ${preset.label} field, but ${missing} ` +
            `${missing === 1 ? "seat" : "seats"} couldn't be resolved — seed ` +
            `${missing === 1 ? "it" : "them"} by hand.`
        )
      }
    } finally {
      setLoadingPreset(null)
    }
  }

  function clearField() {
    setSlots(emptySlots(size))
    setError(null)
  }

  const filledCount = slots.filter(isSlotReady).length
  const allFilled = filledCount === size
  const busy = loadingDefault || submitting || loadingPreset !== null

  async function simulate() {
    if (!allFilled) return
    setSubmitting(true)
    setError(null)
    try {
      // Seeds are positional (ADR-003): slot index 0 is seed 1.
      const config: BracketConfig = {
        bracket_size: size,
        series_format: seriesFormat,
        participants: slots.map((slot, index) => ({
          player_id: slot.player_id as number,
          season_id: slot.season_id as string,
          seed: index + 1,
          name: slot.name,
        })),
      }
      const response = await axios.post<{
        bracket_id: string
        bracket_state: BracketState
      }>(`${API_BASE_URL}/bracket`, config)
      // Lock the page into the running phase in place, then reflect the new
      // bracket id in the URL (replace, so there's no half-built history entry).
      setBracketState(response.data.bracket_state)
      navigate(`/bracket/${response.data.bracket_id}`, { replace: true })
    } catch (caught) {
      setError(getBracketError(caught, "Failed to create the bracket."))
    } finally {
      setSubmitting(false)
    }
  }

  async function runStep(path: "run-round" | "run-all") {
    if (!bracketId || simulating) return
    setSimulating(true)
    setError(null)
    try {
      // Both run endpoints return the updated BracketState, so use it directly.
      const response = await axios.post<BracketState>(
        `${API_BASE_URL}/bracket/${bracketId}/${path}`
      )
      setBracketState(response.data)
    } catch (caught) {
      setError(getBracketError(caught, "Failed to simulate."))
    } finally {
      setSimulating(false)
    }
  }

  async function handleExport() {
    if (!bracketState) return
    setExporting(true)
    try {
      await exportBracketImage(treeRef.current, {
        size: bracketState.bracket_size,
        seriesFormat: bracketState.series_format,
      })
    } finally {
      setExporting(false)
    }
  }

  function startNew() {
    setBracketState(null)
    setError(null)
    navigate("/bracket")
  }

  // Direct load of /bracket/:id (e.g. a refresh) before the state arrives.
  if (bracketId && loading && !bracketState) {
    return (
      <CenteredMessage>
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <p className="kicker text-muted-foreground">Loading bracket…</p>
      </CenteredMessage>
    )
  }

  if (bracketId && error && !bracketState) {
    return (
      <CenteredMessage>
        <AlertTriangle className="h-6 w-6 text-destructive" />
        <p className="text-sm text-muted-foreground">{error}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={startNew}
          className="font-condensed uppercase tracking-[0.14em]"
        >
          <Plus className="h-4 w-4" />
          Start a new bracket
        </Button>
      </CenteredMessage>
    )
  }

  const running = bracketState !== null
  const complete = bracketState?.status === "COMPLETE"

  return (
    <div className="relative mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-screen-xl flex-col px-4 py-8 md:px-6">
      {/* Court geometry + dot grid behind the page header only */}
      <svg
        aria-hidden
        viewBox="0 0 1200 600"
        preserveAspectRatio="xMidYMin slice"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[320px] w-full text-foreground/[0.05] dark:text-foreground/[0.07]"
        fill="none"
      >
        <circle cx="600" cy="-40" r="210" stroke="currentColor" strokeWidth="2" />
        <path
          d="M 120 -20 A 480 480 0 0 0 1080 -20"
          stroke="oklch(0.646 0.222 41 / 0.12)"
          strokeWidth="2"
        />
        <line x1="0" y1="1" x2="1200" y2="1" stroke="currentColor" strokeWidth="2" />
      </svg>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[320px] bg-[radial-gradient(circle,_oklch(0.6_0_0_/_0.12)_1px,_transparent_1px)] [background-size:26px_26px] [mask-image:linear-gradient(to_bottom,black,transparent_70%)]"
      />

      {running && bracketState ? (
        <>
          <div className="mb-4 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="flex flex-col items-start gap-2 animate-in fade-in slide-in-from-bottom-4 duration-700 [animation-fill-mode:both] motion-reduce:animate-none">
              <Kicker ruled>The Road to GOAT</Kicker>
              <h1 className="display text-5xl sm:text-6xl">
                {complete ? "Champion Crowned" : "The Bracket"}
              </h1>
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="font-condensed text-[0.78rem] font-bold uppercase tracking-[0.14em] tabular-nums text-muted-foreground">
                  {bracketState.bracket_size}-player · Bo{bracketState.series_format}
                </span>
                <StatusBadge status={bracketState.status} />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                onClick={startNew}
                className="font-condensed uppercase tracking-[0.14em]"
              >
                <Plus className="h-4 w-4" />
                New bracket
              </Button>
              <Button
                onClick={() => runStep("run-round")}
                disabled={complete || simulating}
                className="font-condensed uppercase tracking-[0.14em]"
              >
                {simulating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <PlayCircle className="h-4 w-4" />
                )}
                Simulate Round
              </Button>
              <Button
                variant="outline"
                onClick={() => runStep("run-all")}
                disabled={complete || simulating}
                className="font-condensed uppercase tracking-[0.14em]"
              >
                {simulating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FastForward className="h-4 w-4" />
                )}
                Simulate All
              </Button>
              <Button
                variant="outline"
                onClick={handleExport}
                disabled={exporting}
                title="Download a poster of your champion"
                className="font-condensed uppercase tracking-[0.14em]"
              >
                {exporting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                Print the Cover
              </Button>
            </div>
          </div>
          <Rule weight="double" className="mb-6" />

          {error && (
            <Alert variant="destructive" className="mb-5">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle className="font-condensed uppercase tracking-[0.14em]">
                Simulation failed
              </AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <BracketBoard state={bracketState} treeRef={treeRef} />
        </>
      ) : (
        <>
          <div className="mb-4 flex flex-col items-start gap-2 animate-in fade-in slide-in-from-bottom-4 duration-700 [animation-fill-mode:both] motion-reduce:animate-none">
            <Kicker ruled>The Road to GOAT</Kicker>
            <h1 className="display text-5xl sm:text-6xl">Draft the Field</h1>
            <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 font-condensed text-[0.78rem] font-bold uppercase tracking-[0.14em] text-muted-foreground">
              <span>Drop a field</span>
              <span aria-hidden>·</span>
              <span>Tune the matchups</span>
              <span aria-hidden>·</span>
              <span>Settle it on the floor</span>
            </p>
          </div>
          <Rule weight="double" className="mb-6" />

          {error && (
            <Alert variant="destructive" className="mb-5">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle className="font-condensed uppercase tracking-[0.14em]">
                Heads up
              </AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
            {/* The Field Office: a sticky command rail for fast field-building,
                format selection, live readiness, and the Tip Off CTA. */}
            <aside className="w-full shrink-0 lg:sticky lg:top-6 lg:w-72">
              <FieldOffice
                size={size}
                seriesFormat={seriesFormat}
                filledCount={filledCount}
                allFilled={allFilled}
                busy={busy}
                submitting={submitting}
                loadingDefault={loadingDefault}
                loadingPreset={loadingPreset}
                onChangeSize={(value) => changeSize(value)}
                onChangeFormat={(value) => setSeriesFormat(value)}
                onAutofill={loadPreconfigured}
                onLoadPreset={loadPreset}
                onClear={clearField}
                onTipOff={simulate}
              />
            </aside>

            <div className="min-w-0 flex-1">
              <BracketBuilder
                size={size}
                slots={slots}
                onUpdateSlot={updateSlot}
                disabled={busy}
              />
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// The setup-phase command rail. Keeps every field-building affordance in one
// readable column: instant preset fields + autofill, the size/format dials, a
// live "X / N seeded" readout, and the gated Tip Off CTA that spells out
// exactly what's missing.
function FieldOffice({
  size,
  seriesFormat,
  filledCount,
  allFilled,
  busy,
  submitting,
  loadingDefault,
  loadingPreset,
  onChangeSize,
  onChangeFormat,
  onAutofill,
  onLoadPreset,
  onClear,
  onTipOff,
}: {
  size: BracketSize
  seriesFormat: SeriesFormat
  filledCount: number
  allFilled: boolean
  busy: boolean
  submitting: boolean
  loadingDefault: boolean
  loadingPreset: string | null
  onChangeSize: (size: BracketSize) => void
  onChangeFormat: (format: SeriesFormat) => void
  onAutofill: () => void
  onLoadPreset: (preset: FieldPreset) => void
  onClear: () => void
  onTipOff: () => void
}) {
  const remaining = size - filledCount
  const progress = size ? filledCount / size : 0
  const hasAny = filledCount > 0

  return (
    <div className="flex flex-col gap-6 rounded-sm border bg-card p-5">
      {/* Readiness meter */}
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <Kicker tone="muted">The Field</Kicker>
          <span className="font-display text-sm font-black uppercase tabular-nums">
            <span className={allFilled ? "text-primary" : "text-foreground"}>
              {filledCount}
            </span>
            <span className="text-muted-foreground"> / {size} seeded</span>
          </span>
        </div>
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={size}
          aria-valuenow={filledCount}
        >
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none",
              allFilled ? "bg-primary" : "bg-foreground/40"
            )}
            style={{ width: `${progress * 100}%` }}
          />
        </div>
        <p className="font-sans text-xs leading-snug text-muted-foreground">
          {allFilled ? (
            <span className="font-semibold text-primary">
              Field set — ready to tip off.
            </span>
          ) : (
            <>
              <span className="tabular-nums font-semibold text-foreground">
                {remaining}
              </span>{" "}
              {remaining === 1 ? "seat" : "seats"} still open.
            </>
          )}
        </p>
      </div>

      {/* Instant fields */}
      <div className="flex flex-col gap-2.5">
        <Kicker tone="muted">Drop a Field</Kicker>
        <Button
          onClick={onAutofill}
          disabled={busy}
          className="w-full justify-start font-condensed uppercase tracking-[0.14em]"
        >
          {loadingDefault ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          Autofill the Legends
        </Button>
        <div className="flex flex-col gap-1.5">
          {FIELD_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => onLoadPreset(preset)}
              disabled={busy}
              className={cn(
                "group flex flex-col items-start gap-0.5 rounded-sm border border-border bg-background px-3 py-2 text-left transition-colors",
                "hover:border-primary hover:bg-primary/5",
                "disabled:cursor-not-allowed disabled:opacity-50"
              )}
            >
              <span className="flex w-full items-center justify-between gap-2">
                <span className="font-display text-sm font-bold uppercase leading-none tracking-tight">
                  {preset.label}
                </span>
                {loadingPreset === preset.id ? (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
                ) : (
                  <span className="font-display text-sm font-black tabular-nums text-muted-foreground group-hover:text-primary">
                    →
                  </span>
                )}
              </span>
              <span className="font-sans text-xs leading-snug text-muted-foreground">
                {preset.blurb}
              </span>
            </button>
          ))}
        </div>
        {hasAny && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            disabled={busy}
            className="h-7 justify-start px-2 font-condensed text-xs uppercase tracking-[0.14em] text-muted-foreground hover:text-destructive"
          >
            <Eraser className="h-3.5 w-3.5" />
            Clear the field
          </Button>
        )}
      </div>

      <Rule />

      {/* Dials */}
      <div className="flex flex-wrap items-end gap-x-8 gap-y-5">
        <SegmentedControl
          label="Field size"
          options={BRACKET_SIZES.map((value) => ({ value, label: `${value}` }))}
          value={size}
          onChange={(value) => onChangeSize(value as BracketSize)}
          disabled={busy}
        />
        <SegmentedControl
          label="Series format"
          options={SERIES_FORMATS.map((value) => ({
            value,
            label: `Bo${value}`,
          }))}
          value={seriesFormat}
          onChange={(value) => onChangeFormat(value as SeriesFormat)}
          disabled={busy}
        />
      </div>

      <Rule />

      {/* Tip Off */}
      <div className="flex flex-col gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            {/* Wrapped in a span so the tooltip still fires while the button is
                disabled (disabled controls emit no hover). */}
            <span className="flex w-full">
              <Button
                size="lg"
                onClick={onTipOff}
                disabled={!allFilled || busy}
                className="w-full font-condensed text-base uppercase tracking-[0.14em]"
              >
                {submitting ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Swords className="h-5 w-5" />
                )}
                Tip Off →
              </Button>
            </span>
          </TooltipTrigger>
          {!allFilled && (
            <TooltipContent className="font-condensed text-xs font-bold uppercase tracking-[0.14em]">
              Seed all <span className="tabular-nums">{size}</span> to tip off —{" "}
              <span className="tabular-nums">{remaining}</span>{" "}
              {remaining === 1 ? "seat" : "seats"} left.
            </TooltipContent>
          )}
        </Tooltip>
        {!allFilled && (
          <p className="text-center font-sans text-xs leading-snug text-muted-foreground">
            Fill every seat to start the tournament.
          </p>
        )}
      </div>
    </div>
  )
}

function SegmentedControl({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string
  options: { value: number; label: string }[]
  value: number
  onChange: (value: number) => void
  disabled?: boolean
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="kicker text-muted-foreground">{label}</span>
      <div className="inline-flex items-end gap-1 border-b border-border">
        {options.map((option) => {
          const active = option.value === value
          return (
            <button
              key={option.value}
              type="button"
              disabled={disabled}
              aria-pressed={active}
              onClick={() => onChange(option.value)}
              className={cn(
                "min-w-[3rem] -mb-px border-b-2 px-3 pb-1.5 pt-1 font-display text-xl font-black uppercase tabular-nums transition-colors",
                "disabled:cursor-not-allowed disabled:opacity-50",
                active
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: BracketState["status"] }) {
  const complete = status === "COMPLETE"
  const label = complete
    ? "Complete"
    : status === "IN_PROGRESS"
      ? "In progress"
      : "Ready to simulate"
  return (
    <Badge
      variant={complete ? "default" : "secondary"}
      className={cn(
        "font-condensed text-xs font-bold uppercase tracking-[0.14em]",
        complete && "border-gold/50 bg-gold/15 text-foreground"
      )}
    >
      {complete && <span className="mr-1.5 h-1.5 w-1.5 bg-gold" />}
      {label}
    </Badge>
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
