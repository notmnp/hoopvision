import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react"
import { Dices, Info, Loader2 } from "lucide-react"

import {
  DraftEra,
  DraftFranchise,
  comboKey,
  fetchEras,
  fetchFranchises,
  fetchPool,
  isAutoRespin,
  PlayerPoolEntry,
} from "@/lib/draft"
import { getTeamColor, getTeamLogoUrlByAbbr, withAlpha } from "@/lib/teamColors"
import { cn } from "@/lib/utils"
import { Kicker } from "@/components/editorial"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export interface SpinResult {
  eraId: string
  eraLabel: string
  franchiseId: string
  franchiseName: string
  franchiseAbbr: string
  comboKey: string
  players: PlayerPoolEntry[]
}

export interface SpinnerHandle {
  spin: () => void
}

interface SpinnerPanelProps {
  /** Era-franchise combo keys already spun this session (excluded). */
  seenComboKeys: Set<string>
  /** Cumulative drafted-player ids passed as the pool exclude list. */
  excludeIds: number[]
  /** Disables the draw trigger while a pool is open awaiting a pick. */
  disabled: boolean
  onSpinStart: () => void
  onResolved: (result: SpinResult) => void
  onError: (message: string) => void
}

// Cosmetic franchise names cycled during the build-up flicker (the resolved
// franchise always comes from the API).
const FRANCHISE_REEL = [
  "Celtics",
  "Lakers",
  "Bulls",
  "Warriors",
  "Spurs",
  "Pistons",
  "76ers",
  "Knicks",
  "Rockets",
  "SuperSonics",
  "Suns",
  "Heat",
  "Nuggets",
  "Bucks",
]
// A decelerating reel that lands on the result — fast frames easing into slow
// ones so the reveal arrives with a beat of anticipation (~0.45s total).
const REVEAL_FRAMES = [40, 55, 75, 105, 150]
// Bound the resolve loop so a fully-exhausted combo space can't draw forever.
const MAX_DRAW_ATTEMPTS = 80

function randomOf<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  )
}

/**
 * SpinnerPanel — the era + franchise draw, presented as a hero "draft lottery"
 * band. A draw resolves both to a random valid unseen combination, fetches the
 * pool with the session exclude list, and transparently re-draws on auto_respin.
 * The reveal builds with a quick decelerating flicker that slams onto the
 * result with the team color flooding in — luck-and-payoff, not a casino reel.
 */
export const SpinnerPanel = forwardRef<SpinnerHandle, SpinnerPanelProps>(
  function SpinnerPanel(
    { seenComboKeys, excludeIds, disabled, onSpinStart, onResolved, onError },
    ref
  ) {
    const [eras, setEras] = useState<DraftEra[]>([])
    const [drawing, setDrawing] = useState(false)
    const [drawn, setDrawn] = useState<SpinResult | null>(null)
    // Cycling text shown during the build-up flicker.
    const [flicker, setFlicker] = useState<{ era: string; franchise: string } | null>(
      null
    )

    const franchiseCache = useRef<Map<string, DraftFranchise[]>>(new Map())
    const latest = useRef({ seenComboKeys, excludeIds, eras })
    latest.current = { seenComboKeys, excludeIds, eras }

    useEffect(() => {
      let cancelled = false
      fetchEras()
        .then((data) => {
          if (!cancelled) setEras(data)
        })
        .catch(() => {
          if (!cancelled) onError("Couldn't load draft eras.")
        })
      return () => {
        cancelled = true
      }
    }, [onError])

    const getFranchises = useCallback(
      async (eraId: string): Promise<DraftFranchise[]> => {
        const cached = franchiseCache.current.get(eraId)
        if (cached) return cached
        const franchises = await fetchFranchises(eraId)
        franchiseCache.current.set(eraId, franchises)
        return franchises
      },
      []
    )

    // Resolve a random unseen combo whose pool isn't depleted; null on failure.
    const resolve = useCallback(async (): Promise<SpinResult | null> => {
      const { eras: eraList } = latest.current
      const dead = new Set<string>(latest.current.seenComboKeys)
      for (let attempt = 0; attempt < MAX_DRAW_ATTEMPTS; attempt++) {
        const era = randomOf(eraList)
        const franchises = await getFranchises(era.id)
        if (franchises.length === 0) continue
        const franchise = randomOf(franchises)
        const key = comboKey(era.id, franchise.id)
        if (dead.has(key)) continue
        const pool = await fetchPool(era.id, franchise.id, latest.current.excludeIds)
        if (isAutoRespin(pool)) {
          dead.add(key)
          continue
        }
        return {
          eraId: era.id,
          eraLabel: era.label,
          franchiseId: franchise.id,
          franchiseName: franchise.name,
          franchiseAbbr: franchise.abbreviation,
          comboKey: key,
          players: pool.players,
        }
      }
      return null
    }, [getFranchises])

    const runSpin = useCallback(async () => {
      const { eras: eraList } = latest.current
      if (drawing || eraList.length === 0) return

      setDrawing(true)
      setDrawn(null)
      onSpinStart()

      const exhausted =
        "You've drafted from every era-franchise combo — start over to go again."
      const failed = "The draw failed to resolve. Try again."

      // Reduced motion: skip the flicker, just resolve and land.
      if (prefersReducedMotion()) {
        try {
          const result = await resolve()
          if (!result) {
            setDrawing(false)
            onError(exhausted)
            return
          }
          setDrawn(result)
          setDrawing(false)
          onResolved(result)
        } catch {
          setDrawing(false)
          onError(failed)
        }
        return
      }

      // Start the fetch and the flicker animation at the SAME time, so the spin
      // is visible instantly rather than waiting on the network.
      let result: SpinResult | null = null
      let errored = false
      let settled = false
      void resolve()
        .then((r) => {
          result = r
        })
        .catch(() => {
          errored = true
        })
        .finally(() => {
          settled = true
        })

      // Spin fast right away; keep cycling until the fetch settles and a minimum
      // beat has elapsed.
      const startedAt = Date.now()
      const MIN_SPIN_MS = 300
      while (!settled || Date.now() - startedAt < MIN_SPIN_MS) {
        setFlicker({
          era: randomOf(eraList).label,
          franchise: randomOf(FRANCHISE_REEL),
        })
        await sleep(55)
      }

      if (errored || !result) {
        setDrawing(false)
        setFlicker(null)
        onError(errored ? failed : exhausted)
        return
      }

      // Decelerate into the landing.
      for (const ms of REVEAL_FRAMES) {
        setFlicker({
          era: randomOf(eraList).label,
          franchise: randomOf(FRANCHISE_REEL),
        })
        await sleep(ms)
      }

      setFlicker(null)
      setDrawn(result)
      setDrawing(false)
      onResolved(result)
    }, [drawing, resolve, onResolved, onError, onSpinStart])

    useImperativeHandle(ref, () => ({ spin: runSpin }), [runSpin])

    const teamColor = drawn ? getTeamColor(drawn.franchiseAbbr) : null

    return (
      <div className="relative overflow-hidden rounded-sm border bg-card p-5 sm:p-6">
        {/* A thin bar of the drawn team's color tops the card — absolutely
            positioned so it overlays the border without affecting padding. */}
        {drawn && teamColor && (
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 h-1"
            style={{ backgroundColor: teamColor }}
          />
        )}
        {/* Offset-print halftone tone — the ISO Lab card treatment: a fine dot
            field bleeding from the top-right corner, neutral until a team is
            drawn, then flooded with the team's color. */}
        <span
          aria-hidden
          className="halftone-splash pointer-events-none absolute inset-0 transition-[background] duration-500"
          style={
            {
              backgroundImage:
                "radial-gradient(var(--splash-dot) 1.4px, transparent 1.9px)",
              backgroundSize: "9px 9px",
              ...(drawn && teamColor
                ? { "--splash-dot": withAlpha(teamColor, 0.2) }
                : {}),
            } as React.CSSProperties
          }
        />

        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          {/* Identity row: the mark + the draw headline. */}
          <div className="flex min-w-0 items-center gap-4">
            <DrawMark drawing={drawing} drawn={drawn} />
            <div className="min-w-0">
              <Kicker ruled tone={drawn ? "primary" : "muted"}>The Draw</Kicker>
              {drawing && flicker ? (
                // The franchise AND the era both spin during the build-up,
                // landing together in the same layout as the resolved draw.
                <div className="mt-1 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                  <p className="display text-2xl leading-none text-foreground/80 sm:text-3xl">
                    {flicker.franchise}
                  </p>
                  <span className="kicker text-muted-foreground/80">
                    {flicker.era}
                  </span>
                </div>
              ) : drawing ? (
                <p className="display mt-1 text-2xl leading-none text-foreground/80 sm:text-3xl">
                  Drawing the lot…
                </p>
              ) : drawn ? (
                <div
                  key={drawn.comboKey}
                  className="mt-1 flex flex-wrap items-baseline gap-x-2.5 gap-y-1 duration-300 animate-in fade-in zoom-in-90"
                >
                  <p className="display text-2xl leading-none text-primary sm:text-3xl">
                    {drawn.franchiseName}
                  </p>
                  <span className="kicker text-muted-foreground">
                    {drawn.eraLabel}
                  </span>
                </div>
              ) : (
                <div className="mt-1 flex items-center gap-2">
                  <p className="display text-2xl leading-none sm:text-3xl">
                    Ready to draft?
                  </p>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-label="How to play"
                        className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <Info className="h-4 w-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-[17rem] text-left">
                      <p className="font-condensed text-[0.7rem] font-bold uppercase tracking-[0.14em] text-background/70">
                        How to play
                      </p>
                      <ol className="mt-1.5 list-decimal space-y-1 pl-4 text-xs normal-case leading-relaxed">
                        <li>Spin to draw a random era + franchise.</li>
                        <li>Draft one player per slot, PG through C.</li>
                        <li>
                          Fill all five and your lineup is graded into an
                          82-game record.
                        </li>
                      </ol>
                      <p className="mt-1.5 text-xs italic leading-relaxed">
                        Build a five great enough to go 82-0.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              )}
            </div>
          </div>

          {/* The draw CTA, inline to the right of the headline. */}
          <Tooltip>
            <TooltipTrigger asChild>
              {/* Wrapped in a span so the tooltip still fires while the button
                  is disabled (disabled controls emit no hover). */}
              <span className="flex w-full shrink-0 sm:w-auto">
                <Button
                  onClick={runSpin}
                  disabled={disabled || drawing || eras.length === 0}
                  className="w-full font-condensed font-bold uppercase tracking-[0.14em]"
                >
                  {drawing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Dices className="h-4 w-4" />
                  )}
                  {drawing
                    ? "Drawing…"
                    : drawn
                      ? "Get your next team"
                      : "Get your first team"}
                </Button>
              </span>
            </TooltipTrigger>
            {disabled && !drawing && (
              <TooltipContent className="font-condensed text-xs font-bold uppercase tracking-[0.14em]">
                Select and assign a player to your lineup first.
              </TooltipContent>
            )}
          </Tooltip>
        </div>
      </div>
    )
  }
)

// The mark to the left of the draw text: the franchise logo/monogram once
// drawn, a flicker placeholder while drawing, or the dice when idle.
function DrawMark({
  drawing,
  drawn,
}: {
  drawing: boolean
  drawn: SpinResult | null
}) {
  if (drawn && !drawing) return <TeamMark abbr={drawn.franchiseAbbr} />
  // While drawing, the dice rolls (pulses) rather than adding a second spinner —
  // the reel flicker + the button spinner are the only motion the draw needs.
  return (
    <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-sm border bg-background">
      <Dices
        className={cn(
          "h-6 w-6 text-muted-foreground",
          drawing && "animate-pulse text-primary"
        )}
      />
    </span>
  )
}

// Muted team identity: the current franchise logo where one exists, otherwise a
// team-colored abbreviation monogram (relocated/historical identities).
function TeamMark({ abbr }: { abbr: string }) {
  const logo = getTeamLogoUrlByAbbr(abbr)
  const color = getTeamColor(abbr)

  if (logo) {
    return (
      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-sm border bg-background duration-300 animate-in zoom-in-90">
        <img
          src={logo}
          alt=""
          aria-hidden
          className="h-11 w-11 object-contain"
          style={{ filter: "grayscale(0.55) contrast(1.05)", opacity: 0.92 }}
        />
      </span>
    )
  }

  return (
    <span
      className={cn(
        "flex h-14 w-14 shrink-0 items-center justify-center rounded-sm border bg-background duration-300 animate-in zoom-in-90",
        "font-display text-base font-black tabular-nums"
      )}
      style={color ? { color, borderColor: withAlpha(color, 0.5) } : undefined}
    >
      {abbr}
    </span>
  )
}
