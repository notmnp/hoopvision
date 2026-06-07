import { useCallback, useRef, useState } from "react"
import axios from "axios"
import { AlertTriangle } from "lucide-react"

import {
  DraftScore,
  DraftSlot,
  PlayerPoolEntry,
  PositionSlot,
  emptyLineup,
  postScore,
} from "@/lib/draft"
import { cn } from "@/lib/utils"
import { useMediaQuery } from "@/hooks/useMediaQuery"
import { Kicker, Rule } from "@/components/editorial"
import { HeaderBackdrop } from "@/components/HeaderBackdrop"
import { SpinnerPanel, SpinnerHandle, SpinResult } from "@/components/SpinnerPanel"
import { CourtDraftBoard } from "@/components/CourtDraftBoard"
import { PlayerPoolPanel } from "@/components/PlayerPoolPanel"
import { PlacementSheet } from "@/components/PlacementSheet"
import { DraftResultCard } from "@/components/DraftResultCard"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

// idle: spin available · spinning: reels turning / pool loading
// placement: pool open, awaiting a pick · result: lineup locked, score shown
type DraftPhase = "idle" | "spinning" | "placement" | "result"

/**
 * DraftWorkspace — owner of the entire client-side draft session (ADR-002). It
 * holds the lineup, the spin-history (seen era-franchise combos) and the
 * drafted-player exclusion set, mediates selection between PlayerPoolPanel and
 * CourtDraftBoard,
 * and on completion POSTs the lineup to /draft/score. No server session exists;
 * a refresh restarts the draft.
 */
export default function DraftWorkspace() {
  const [phase, setPhase] = useState<DraftPhase>("idle")
  const [lineup, setLineup] = useState<DraftSlot[]>(emptyLineup)

  // Session dedup state passed down to the spinner.
  const [seenComboKeys, setSeenComboKeys] = useState<Set<string>>(new Set())
  const [seenPlayerIds, setSeenPlayerIds] = useState<number[]>([])

  // Current open pool + the spin it came from (era/franchise carried onto picks).
  const [pool, setPool] = useState<PlayerPoolEntry[]>([])
  const [currentSpin, setCurrentSpin] = useState<SpinResult | null>(null)
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerPoolEntry | null>(null)

  const [score, setScore] = useState<DraftScore | null>(null)
  const [scoreLoading, setScoreLoading] = useState(false)
  const [scoreError, setScoreError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const spinnerRef = useRef<SpinnerHandle>(null)

  // Below lg the Starting Five board is a long scroll below the pool, so a
  // selection there can't be placed at a glance — raise a bottom sheet instead.
  const isCompact = useMediaQuery("(max-width: 1023px)")

  const filledCount = lineup.filter((slot) => slot.pick !== null).length

  const handleSpinStart = useCallback(() => {
    setError(null)
    setSelectedPlayer(null)
    setPool([])
    setPhase("spinning")
  }, [])

  const handleResolved = useCallback((result: SpinResult) => {
    // Record only the combo so the same era+franchise never repeats this session
    // (AC-ATD-008.1). Players are NOT excluded on sight — merely surfacing a
    // player leaves them free to reappear (and be drafted) on another combo.
    // Exclusion happens on pick, in handlePlace.
    setSeenComboKeys((prev) => new Set(prev).add(result.comboKey))
    setCurrentSpin(result)
    setPool(result.players)
    setSelectedPlayer(null)
    setPhase("placement")
  }, [])

  const handleSpinError = useCallback((message: string) => {
    setError(message)
    setPhase("idle")
  }, [])

  const runScore = useCallback(async (finalLineup: DraftSlot[]) => {
    setScoreLoading(true)
    setScoreError(null)
    try {
      const players = finalLineup.map((slot) => ({
        player_id: slot.pick!.player.player_id,
        season_id: slot.pick!.player.season_id,
        position_slot: slot.position,
      }))
      setScore(await postScore(players))
    } catch (caught) {
      setScoreError(getDraftError(caught))
    } finally {
      setScoreLoading(false)
    }
  }, [])

  const handlePlace = useCallback(
    (position: PositionSlot, player: PlayerPoolEntry) => {
      if (!currentSpin) return
      const nextLineup = lineup.map((slot) =>
        slot.position === position
          ? {
              ...slot,
              pick: {
                player,
                eraId: currentSpin.eraId,
                eraLabel: currentSpin.eraLabel,
                franchiseId: currentSpin.franchiseId,
                franchiseName: currentSpin.franchiseName,
                franchiseAbbr: currentSpin.franchiseAbbr,
              },
            }
          : slot
      )
      // Only a drafted player is retired from future pools (AC-ATD-008.2) — so
      // the same person can't be picked twice, while the unpicked stay available.
      setSeenPlayerIds((prev) => [...prev, player.player_id])
      setLineup(nextLineup)
      setSelectedPlayer(null)
      setPool([])
      setCurrentSpin(null)

      if (nextLineup.every((slot) => slot.pick !== null)) {
        setPhase("result")
        runScore(nextLineup)
      } else {
        setPhase("idle")
      }
    },
    [currentSpin, lineup, runScore]
  )

  const handleRespin = useCallback(() => {
    setSelectedPlayer(null)
    setPool([])
    spinnerRef.current?.spin()
  }, [])

  const handlePlayAgain = useCallback(() => {
    setPhase("idle")
    setLineup(emptyLineup())
    setSeenComboKeys(new Set())
    setSeenPlayerIds([])
    setPool([])
    setCurrentSpin(null)
    setSelectedPlayer(null)
    setScore(null)
    setScoreError(null)
    setError(null)
  }, [])

  const isResult = phase === "result"

  return (
    <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-screen-xl flex-col px-4 py-8 md:px-6">
      <div className="relative isolate mb-6 flex flex-col gap-4 pb-6 md:flex-row md:items-end md:justify-between">
        <HeaderBackdrop figure="82-0" />
        <div>
          <Kicker ruled>The Front Office</Kicker>
          <h1 className="mt-2 display text-5xl sm:text-6xl">Create a Dynasty</h1>
          <p className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-condensed text-[0.78rem] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            <span>Spin an era + franchise</span>
            <span aria-hidden>·</span>
            <span>Draft a starting five</span>
            <span aria-hidden>·</span>
            <span>Sim the season</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "size-2 shrink-0 rounded-full",
              filledCount === 5 ? "bg-court" : "bg-muted-foreground/40"
            )}
            aria-hidden
          />
          <span
            className={cn(
              "kicker tabular-nums",
              filledCount === 5 ? "text-foreground" : "text-muted-foreground"
            )}
          >
            {filledCount === 5 ? "Five drafted" : `${filledCount} / 5 drafted`}
          </span>
        </div>
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

      {isResult ? (
        <DraftResultCard
          lineup={lineup}
          score={score}
          loading={scoreLoading}
          error={scoreError}
          onRetry={() => runScore(lineup)}
          onPlayAgain={handlePlayAgain}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          {/* Main column: the draw hero + the player pool it surfaces. */}
          <div className="flex min-w-0 flex-col gap-6">
            <SpinnerPanel
              ref={spinnerRef}
              seenComboKeys={seenComboKeys}
              excludeIds={seenPlayerIds}
              disabled={phase === "placement"}
              onSpinStart={handleSpinStart}
              onResolved={handleResolved}
              onError={handleSpinError}
            />

            {phase === "placement" && currentSpin ? (
              <PlayerPoolPanel
                players={pool}
                lineup={lineup}
                selectedPlayer={selectedPlayer}
                franchiseAbbr={currentSpin.franchiseAbbr}
                onSelect={setSelectedPlayer}
                onRespin={handleRespin}
              />
            ) : phase === "idle" ? (
              <DrawHint />
            ) : null}
          </div>

          {/* Sidebar: the running starting five, sticky as you scroll the pool. */}
          <aside className="lg:sticky lg:top-20 lg:self-start">
            <CourtDraftBoard
              lineup={lineup}
              selectedPlayer={selectedPlayer}
              onPlace={handlePlace}
            />
          </aside>
        </div>
      )}

      {/* Touch-first placement: on compact screens a pool selection opens a
          bottom sheet to choose the slot, rather than scrolling to the board. */}
      <PlacementSheet
        open={isCompact && !isResult && selectedPlayer !== null}
        player={selectedPlayer}
        lineup={lineup}
        franchiseAbbr={currentSpin?.franchiseAbbr}
        onOpenChange={(open) => {
          if (!open) setSelectedPlayer(null)
        }}
        onPlace={handlePlace}
      />
    </div>
  )
}

// Idle main-column placeholder so the spread has presence before the first draw.
// Hidden on phones, where the empty dashed box is just dead space below the
// spinner — the draw CTA already tells you what to do.
function DrawHint() {
  return (
    <div className="hidden h-[31rem] flex-col items-center justify-center gap-2 rounded-sm border border-dashed p-10 text-center sm:flex">
      <Kicker tone="muted">The Pool</Kicker>
      <p className="max-w-prose font-display text-lg italic leading-snug text-muted-foreground">
        Draw an era and franchise to reveal their player pool.
      </p>
    </div>
  )
}

function getDraftError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail
    if (typeof detail === "string") return detail
    if (!error.response) return "Backend is unavailable."
  }
  return "Failed to simulate the lineup."
}
