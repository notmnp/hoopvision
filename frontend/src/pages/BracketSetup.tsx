import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import axios from "axios"
import {
  AlertTriangle,
  Download,
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
  SERIES_FORMATS,
  SeriesFormat,
  emptySlots,
  isSlotReady,
} from "@/lib/bracket"
import { exportBracketImage } from "@/lib/bracketExporter"
import { cn } from "@/lib/utils"
import { BracketBuilder } from "@/components/BracketBuilder"
import { BracketBoard } from "@/components/BracketBoard"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

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

  const filledCount = slots.filter(isSlotReady).length
  const allFilled = filledCount === size
  const busy = loadingDefault || submitting

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
        <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
          Loading bracket…
        </p>
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
          className="font-mono uppercase tracking-wider"
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

      <div className="mb-6 flex flex-col gap-4 border-b pb-6 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-col items-start gap-2 animate-in fade-in slide-in-from-bottom-4 duration-700 [animation-fill-mode:both] motion-reduce:animate-none">
          {running && bracketState ? (
            <>
              <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
                <span>GOAT Bracket</span>
                <span className="text-amber-500/60">◆</span>
                <span className="tabular-nums">
                  {bracketState.bracket_size}-player · Bo
                  {bracketState.series_format}
                </span>
              </div>
              <h1 className="font-display text-3xl font-black uppercase tracking-tight sm:text-4xl">
                {complete ? "Champion crowned" : "Tournament bracket"}
              </h1>
              <StatusBadge status={bracketState.status} />
            </>
          ) : (
            <>
              <span className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
                GOAT Bracket
              </span>
              <h1 className="font-display text-3xl font-black uppercase tracking-tight sm:text-4xl">
                Build your tournament
              </h1>
              <p className="max-w-md text-pretty text-sm leading-relaxed text-muted-foreground">
                Fill every slot in the bracket, then run each matchup as a
                best-of series through the IsoLab engine until one champion
                remains.
              </p>
            </>
          )}
        </div>

        {running ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={startNew}
              className="font-mono uppercase tracking-wider"
            >
              <Plus className="h-4 w-4" />
              New bracket
            </Button>
            <Button
              onClick={() => runStep("run-round")}
              disabled={complete || simulating}
              className="font-mono uppercase tracking-wider"
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
              className="font-mono uppercase tracking-wider"
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
              className="font-mono uppercase tracking-wider"
            >
              {exporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Export Bracket
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-stretch gap-3 sm:items-end">
            <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-end">
              <Button
                variant="secondary"
                onClick={loadPreconfigured}
                disabled={busy}
                className="font-mono uppercase tracking-wider sm:w-auto"
              >
                {loadingDefault ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                Autofill Players
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  {/* Wrapped in a span so the tooltip still fires while the
                      button is disabled (disabled controls emit no hover). */}
                  <span className="flex w-full sm:w-auto">
                    <Button
                      onClick={simulate}
                      disabled={!allFilled || busy}
                      className="w-full font-mono uppercase tracking-wider sm:w-auto"
                    >
                      {submitting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Swords className="h-4 w-4" />
                      )}
                      Simulate
                    </Button>
                  </span>
                </TooltipTrigger>
                {!allFilled && (
                  <TooltipContent className="font-mono text-xs uppercase tracking-wider">
                    <span className="tabular-nums">{size - filledCount}</span> more{" "}
                    {size - filledCount === 1 ? "player" : "players"} to set
                    before you can simulate.
                  </TooltipContent>
                )}
              </Tooltip>
            </div>
          </div>
        )}
      </div>

      {error && (
        <Alert variant="destructive" className="mb-5">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle className="font-mono uppercase tracking-wider">
            {running ? "Simulation failed" : "Couldn't continue"}
          </AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {running && bracketState ? (
        <BracketBoard state={bracketState} treeRef={treeRef} />
      ) : (
        <>
          <BracketBuilder
            size={size}
            slots={slots}
            onUpdateSlot={updateSlot}
            disabled={busy}
          />
          <div className="mt-6 flex flex-wrap items-end gap-6 border-t pt-6">
            <SegmentedControl
              label="Bracket size"
              options={BRACKET_SIZES.map((value) => ({
                value,
                label: `${value}`,
              }))}
              value={size}
              onChange={(value) => changeSize(value as BracketSize)}
              disabled={busy}
            />
            <SegmentedControl
              label="Series format"
              options={SERIES_FORMATS.map((value) => ({
                value,
                label: `Bo${value}`,
              }))}
              value={seriesFormat}
              onChange={(value) => setSeriesFormat(value as SeriesFormat)}
              disabled={busy}
            />
          </div>
        </>
      )}
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
    <div className="flex flex-col gap-1.5">
      <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <div className="inline-flex rounded-md border bg-muted/40 p-0.5">
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
                "min-w-[3rem] rounded-[5px] px-3 py-1.5 font-mono text-sm font-medium uppercase tracking-wider tabular-nums transition-colors",
                "disabled:cursor-not-allowed disabled:opacity-50",
                active
                  ? "border border-amber-500/40 bg-amber-500/10 text-amber-600 shadow-sm shadow-amber-500/10 dark:text-amber-400"
                  : "border border-transparent text-muted-foreground hover:text-foreground"
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
        "font-mono text-[0.65rem] uppercase tracking-wider",
        complete &&
          "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
      )}
    >
      {complete && <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-amber-500" />}
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
