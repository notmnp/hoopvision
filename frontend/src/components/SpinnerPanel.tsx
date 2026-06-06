import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react"
import { Dices, Loader2 } from "lucide-react"

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
import { cn } from "@/lib/utils"
import { Kicker } from "@/components/editorial"
import { Button } from "@/components/ui/button"

export interface SpinResult {
  eraId: string
  eraLabel: string
  franchiseId: string
  franchiseName: string
  comboKey: string
  players: PlayerPoolEntry[]
}

export interface SpinnerHandle {
  spin: () => void
}

interface SpinnerPanelProps {
  /** Era-franchise combo keys already spun this session (excluded). */
  seenComboKeys: Set<string>
  /** Cumulative seen-player ids passed as the pool exclude list. */
  excludeIds: number[]
  /** Disables the spin trigger while a pool is open awaiting a pick. */
  disabled: boolean
  onSpinStart: () => void
  onResolved: (result: SpinResult) => void
  onError: (message: string) => void
}

// Names shown only while the franchise reel is flickering (cosmetic); the
// resolved franchise always comes from the API.
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
]

const FLICKER_MS = 70
const MIN_SPIN_MS = 750
// Bound the resolve loop so a fully-exhausted combo space can't spin forever.
const MAX_SPIN_ATTEMPTS = 80

function randomOf<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  )
}

/**
 * SpinnerPanel — the era + franchise selectors. On a spin it resolves both to a
 * random valid combination (excluding combos already seen this session),
 * fetches the player pool with the session exclude list, transparently
 * re-spins on an auto_respin signal, and surfaces the resolved pool upward.
 */
export const SpinnerPanel = forwardRef<SpinnerHandle, SpinnerPanelProps>(
  function SpinnerPanel(
    { seenComboKeys, excludeIds, disabled, onSpinStart, onResolved, onError },
    ref
  ) {
    const [eras, setEras] = useState<DraftEra[]>([])
    const [spinning, setSpinning] = useState(false)
    const [eraDisplay, setEraDisplay] = useState<string>("—")
    const [franchiseDisplay, setFranchiseDisplay] = useState<string>("—")
    const [resolved, setResolved] = useState(false)

    // Per-era franchise cache so repeated spins don't refetch the same list.
    const franchiseCache = useRef<Map<string, DraftFranchise[]>>(new Map())
    const flickerTimer = useRef<ReturnType<typeof setInterval> | null>(null)
    // Latest props captured in a ref so the imperative spin() always reads
    // current values without being re-created (and re-flickering) each render.
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

    useEffect(() => {
      return () => {
        if (flickerTimer.current) clearInterval(flickerTimer.current)
      }
    }, [])

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

    const startFlicker = useCallback((eraList: DraftEra[]) => {
      if (prefersReducedMotion()) return
      flickerTimer.current = setInterval(() => {
        setEraDisplay(randomOf(eraList).label)
        setFranchiseDisplay(randomOf(FRANCHISE_REEL))
      }, FLICKER_MS)
    }, [])

    const stopFlicker = useCallback(() => {
      if (flickerTimer.current) {
        clearInterval(flickerTimer.current)
        flickerTimer.current = null
      }
    }, [])

    const runSpin = useCallback(async () => {
      const { eras: eraList } = latest.current
      if (spinning || eraList.length === 0) return

      setSpinning(true)
      setResolved(false)
      onSpinStart()
      startFlicker(eraList)
      const startedAt = Date.now()

      // Combos found dead this spin (already seen, or auto_respin) so we don't
      // reselect them within the same resolve loop.
      const dead = new Set<string>(latest.current.seenComboKeys)
      try {
        for (let attempt = 0; attempt < MAX_SPIN_ATTEMPTS; attempt++) {
          const era = randomOf(eraList)
          const franchises = await getFranchises(era.id)
          if (franchises.length === 0) continue
          const franchise = randomOf(franchises)
          const key = comboKey(era.id, franchise.id)
          if (dead.has(key)) continue

          const pool = await fetchPool(
            era.id,
            franchise.id,
            latest.current.excludeIds
          )
          if (isAutoRespin(pool)) {
            // Too few players left for this combo — burn it and keep spinning.
            dead.add(key)
            continue
          }

          // Hold the spin animation for a minimum beat so it reads as a spin.
          const elapsed = Date.now() - startedAt
          if (elapsed < MIN_SPIN_MS && !prefersReducedMotion()) {
            await new Promise((r) => setTimeout(r, MIN_SPIN_MS - elapsed))
          }
          stopFlicker()
          setEraDisplay(era.label)
          setFranchiseDisplay(franchise.name)
          setResolved(true)
          setSpinning(false)
          onResolved({
            eraId: era.id,
            eraLabel: era.label,
            franchiseId: franchise.id,
            franchiseName: franchise.name,
            comboKey: key,
            players: pool.players,
          })
          return
        }
        // Loop exhausted: effectively every combo is seen or depleted.
        stopFlicker()
        setSpinning(false)
        onError("You've drafted from every era-franchise combo — start over to go again.")
      } catch {
        stopFlicker()
        setSpinning(false)
        onError("The spin failed to resolve. Try again.")
      }
    }, [spinning, getFranchises, onResolved, onError, onSpinStart, startFlicker, stopFlicker])

    useImperativeHandle(ref, () => ({ spin: runSpin }), [runSpin])

    return (
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Reel label="Era" value={eraDisplay} spinning={spinning} resolved={resolved} />
          <Reel
            label="Franchise"
            value={franchiseDisplay}
            spinning={spinning}
            resolved={resolved}
          />
        </div>
        <Button
          onClick={runSpin}
          disabled={disabled || spinning || eras.length === 0}
          size="lg"
          className="font-condensed font-bold uppercase tracking-[0.14em]"
        >
          {spinning ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Dices className="h-4 w-4" />
          )}
          {spinning ? "Spinning…" : "Spin to draft"}
        </Button>
      </div>
    )
  }
)

function Reel({
  label,
  value,
  spinning,
  resolved,
}: {
  label: string
  value: string
  spinning: boolean
  resolved: boolean
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-1.5 rounded-sm border bg-card px-3 py-4 text-center transition-colors",
        resolved && !spinning && "border-primary"
      )}
    >
      <Kicker tone="muted">{label}</Kicker>
      <span
        className={cn(
          "display text-2xl leading-tight sm:text-3xl",
          spinning && "tabular-nums opacity-70 blur-[0.4px]",
          resolved && !spinning && "text-primary"
        )}
      >
        {value}
      </span>
    </div>
  )
}
