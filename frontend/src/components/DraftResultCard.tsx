import { useRef, useState } from "react"
import { AlertTriangle, Download, Loader2, RotateCcw } from "lucide-react"

import {
  DraftScore,
  DraftScoreBreakdown,
  DraftSlot,
  PositionSlot,
  SLOT_ORDER,
  headshotUrl,
} from "@/lib/draft"
import { exportDraftCard } from "@/lib/draftExporter"
import { HalftoneAvatar, Kicker, Masthead, Rule } from "@/components/editorial"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

interface DraftResultCardProps {
  lineup: DraftSlot[]
  score: DraftScore | null
  loading: boolean
  error: string | null
  onRetry: () => void
  onPlayAgain: () => void
}

// The era/franchise each slot was drafted from lives on the lineup, not in the
// score response, so join the two by position slot.
interface ResultRow {
  breakdown: DraftScoreBreakdown
  eraLabel: string
  franchiseName: string
  contributionPct: number
}

export function DraftResultCard({
  lineup,
  score,
  loading,
  error,
  onRetry,
  onPlayAgain,
}: DraftResultCardProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [sharing, setSharing] = useState(false)

  if (loading) {
    return (
      <Centered>
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <p className="kicker text-muted-foreground">Simulating the season…</p>
      </Centered>
    )
  }

  if (error) {
    return (
      <Centered>
        <AlertTriangle className="h-6 w-6 text-destructive" />
        <p className="text-sm text-muted-foreground">{error}</p>
        <Button
          variant="outline"
          onClick={onRetry}
          className="font-condensed font-bold uppercase tracking-[0.14em]"
        >
          Try again
        </Button>
      </Centered>
    )
  }

  if (!score) return null

  const lineupBySlot = new Map<PositionSlot, DraftSlot>(
    lineup.map((slot) => [slot.position, slot])
  )
  const total =
    score.breakdown.reduce((sum, b) => sum + b.contribution_score, 0) || 1
  const rows: ResultRow[] = [...score.breakdown]
    .sort(
      (a, b) =>
        SLOT_ORDER.indexOf(a.position_slot as PositionSlot) -
        SLOT_ORDER.indexOf(b.position_slot as PositionSlot)
    )
    .map((breakdown) => {
      const pick = lineupBySlot.get(breakdown.position_slot as PositionSlot)?.pick
      return {
        breakdown,
        eraLabel: pick?.eraLabel ?? "",
        franchiseName: pick?.franchiseName ?? "",
        contributionPct: (breakdown.contribution_score / total) * 100,
      }
    })

  async function handleShare() {
    setSharing(true)
    try {
      await exportDraftCard(cardRef.current, {
        wins: score!.wins,
        losses: score!.losses,
      })
    } catch {
      // A failed export should never crash the result view.
    } finally {
      setSharing(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      {/* Everything inside cardRef is what the PNG share card captures, so it
          carries its own masthead and is self-contained outside the app. */}
      <div ref={cardRef} className="flex flex-col gap-5 rounded-sm border bg-card p-6">
        <Masthead detail="All-Time Draft" />
        <Rule weight="double" />

        <div className="flex flex-col items-center gap-1 text-center">
          <Kicker tone="muted">Projected 82-game record</Kicker>
          <span className="display text-7xl leading-none tabular-nums sm:text-8xl">
            {score.wins}
            <span className="text-muted-foreground">–</span>
            {score.losses}
          </span>
        </div>

        <Rule />

        <div className="flex flex-col gap-2.5">
          {rows.map((row) => (
            <ResultPlayerRow key={row.breakdown.position_slot} row={row} />
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button
          variant="outline"
          onClick={handleShare}
          disabled={sharing}
          className="font-condensed font-bold uppercase tracking-[0.14em]"
        >
          {sharing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          Share card
        </Button>
        <Button
          onClick={onPlayAgain}
          className="font-condensed font-bold uppercase tracking-[0.14em]"
        >
          <RotateCcw className="h-4 w-4" />
          Play again
        </Button>
      </div>
    </div>
  )
}

function ResultPlayerRow({ row }: { row: ResultRow }) {
  const { breakdown, eraLabel, franchiseName, contributionPct } = row
  const { metrics } = breakdown
  return (
    <div className="flex items-center gap-3 rounded-sm border border-border/70 p-2.5">
      <HalftoneAvatar
        src={headshotUrl(breakdown.player_id)}
        alt={breakdown.name}
        crossOrigin="anonymous"
        size={48}
        className="rounded-sm"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="px-1.5 py-0 text-[0.62rem]">
            {breakdown.position_slot}
          </Badge>
          <span className="truncate font-display text-sm font-semibold">
            {breakdown.name}
          </span>
        </div>
        <span className="kicker text-muted-foreground">
          {[eraLabel, franchiseName].filter(Boolean).join(" · ")}
        </span>
        <div className="mt-0.5 flex items-center gap-3 font-condensed text-[0.66rem] font-bold uppercase tracking-[0.08em] tabular-nums text-muted-foreground">
          <span>WS/48 {threeDp(metrics.ws_per_48)}</span>
          <span>BPM {signed(metrics.bpm)}</span>
          <span>VORP {oneDp(metrics.vorp)}</span>
          <span>TS {pct(metrics.ts_pct)}</span>
        </div>
      </div>
      {/* Contribution as a share of the team's weighted total. */}
      <div className="flex w-16 shrink-0 flex-col items-end gap-1">
        <span className="font-display text-base font-semibold tabular-nums">
          {contributionPct.toFixed(0)}%
        </span>
        <span className="h-1 w-full overflow-hidden rounded-full bg-muted">
          <span
            className="block h-full bg-primary"
            style={{ width: `${Math.min(100, contributionPct)}%` }}
          />
        </span>
      </div>
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-4 rounded-sm border bg-card p-10 text-center">
      {children}
    </div>
  )
}

function threeDp(value: number): string {
  return value.toFixed(3).replace(/^0\./, ".").replace(/^-0\./, "-.")
}

function oneDp(value: number): string {
  return value.toFixed(1)
}

function signed(value: number): string {
  return value > 0 ? `+${value.toFixed(1)}` : value.toFixed(1)
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}
