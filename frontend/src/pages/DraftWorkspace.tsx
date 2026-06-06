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
import { Kicker, Rule } from "@/components/editorial"
import { HeaderBackdrop } from "@/components/HeaderBackdrop"
import { SpinnerPanel, SpinnerHandle, SpinResult } from "@/components/SpinnerPanel"
import { CourtDraftBoard } from "@/components/CourtDraftBoard"
import { PlayerPoolPanel } from "@/components/PlayerPoolPanel"
import { DraftResultCard } from "@/components/DraftResultCard"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

// idle: spin available · spinning: reels turning / pool loading
// placement: pool open, awaiting a pick · result: lineup locked, score shown
type DraftPhase = "idle" | "spinning" | "placement" | "result"

/**
 * DraftWorkspace — owner of the entire client-side draft session (ADR-002). It
 * holds the lineup, the spin-history (seen era-franchise combos) and seen-player
 * exclusion sets, mediates selection between PlayerPoolPanel and CourtDraftBoard,
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

  const filledCount = lineup.filter((slot) => slot.pick !== null).length

  const handleSpinStart = useCallback(() => {
    setError(null)
    setSelectedPlayer(null)
    setPool([])
    setPhase("spinning")
  }, [])

  const handleResolved = useCallback((result: SpinResult) => {
    // Record the combo + every surfaced player so neither repeats this session
    // (AC-ATD-008.1 / AC-ATD-008.2).
    setSeenComboKeys((prev) => new Set(prev).add(result.comboKey))
    setSeenPlayerIds((prev) => [
      ...prev,
      ...result.players.map((p) => p.player_id),
    ])
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
              },
            }
          : slot
      )
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
        <HeaderBackdrop figure="DRAFT" />
        <div>
          <Kicker ruled>Luck Meets Strategy</Kicker>
          <h1 className="mt-2 display text-5xl sm:text-6xl">All-Time Draft</h1>
          <p className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-condensed text-[0.78rem] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            <span>Spin an era + franchise</span>
            <span aria-hidden>·</span>
            <span>Draft a starting five</span>
            <span aria-hidden>·</span>
            <span>Simulate 82 games</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="kicker tabular-nums text-muted-foreground">
            {filledCount} / 5 drafted
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
        <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
          <CourtDraftBoard
            lineup={lineup}
            selectedPlayer={selectedPlayer}
            onPlace={handlePlace}
          />

          <div className="flex flex-col gap-4">
            <SpinnerPanel
              ref={spinnerRef}
              seenComboKeys={seenComboKeys}
              excludeIds={seenPlayerIds}
              disabled={phase === "placement"}
              onSpinStart={handleSpinStart}
              onResolved={handleResolved}
              onError={handleSpinError}
            />

            {phase === "placement" && currentSpin && (
              <>
                <p className="text-center font-condensed text-[0.78rem] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                  {currentSpin.eraLabel} · {currentSpin.franchiseName}
                </p>
                <PlayerPoolPanel
                  players={pool}
                  lineup={lineup}
                  selectedPlayer={selectedPlayer}
                  onSelect={setSelectedPlayer}
                  onRespin={handleRespin}
                />
              </>
            )}
          </div>
        </div>
      )}
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
