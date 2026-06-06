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
import { getTeamColor, withAlpha } from "@/lib/teamColors"
import { cn } from "@/lib/utils"
import { HalftoneAvatar, Kicker, Rule } from "@/components/editorial"
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

// A drafted juggernaut is a champion-like payoff — gold (champion-only per the
// design rules) is reserved for this rare elite tier.
const ELITE_WINS = 70

interface ResultRow {
  breakdown: DraftScoreBreakdown
  eraLabel: string
  franchiseName: string
  franchiseAbbr: string
  contributionPct: number
  isTopContributor: boolean
}

function verdictCaption(wins: number): string {
  if (wins >= 73) return "A juggernaut for the ages."
  if (wins >= 60) return "A bona-fide contender."
  if (wins >= 50) return "A solid playoff team."
  if (wins >= 41) return "Hovering around .500."
  return "Lottery-bound."
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
        <Kicker tone="muted">Simulating the season…</Kicker>
      </Centered>
    )
  }

  if (error) {
    return (
      <Centered>
        <AlertTriangle className="h-6 w-6 text-destructive" />
        <Kicker tone="muted">Couldn't simulate</Kicker>
        <p className="max-w-prose text-sm text-muted-foreground">{error}</p>
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

  const elite = score.wins >= ELITE_WINS
  const lineupBySlot = new Map<PositionSlot, DraftSlot>(
    lineup.map((slot) => [slot.position, slot])
  )
  const total =
    score.breakdown.reduce((sum, b) => sum + b.contribution_score, 0) || 1
  const topScore = Math.max(...score.breakdown.map((b) => b.contribution_score))
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
        franchiseAbbr: pick?.franchiseAbbr ?? "",
        contributionPct: (breakdown.contribution_score / total) * 100,
        isTopContributor: breakdown.contribution_score === topScore,
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
    <div className="flex w-full flex-col gap-4">
      {/* Everything inside cardRef is what the PNG share card captures. A
          full-width two-column spread (verdict | box score) matching the other
          pages' result layouts. */}
      <div
        ref={cardRef}
        className="grid gap-6 rounded-sm border bg-card p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.55fr)]"
      >
        {/* The verdict — the editorial hero, framed on a halftone field. Gold
            (champion-only) lights up the splash for a rare elite record. */}
        <div
          className={cn(
            "relative flex flex-col items-center justify-center gap-2 overflow-hidden rounded-sm border px-4 py-10 text-center",
            elite && "border-gold/60"
          )}
        >
          <span
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-0",
              elite ? "halftone-splash" : "halftone opacity-50"
            )}
            style={
              elite
                ? ({
                    "--splash-dot":
                      "color-mix(in oklch, var(--gold) 32%, transparent)",
                    backgroundImage:
                      "radial-gradient(var(--splash-dot) 1.6px, transparent 2.2px)",
                    backgroundSize: "11px 11px",
                  } as React.CSSProperties)
                : undefined
            }
          />
          <Kicker ruled tone="muted" className="relative">
            {elite ? "A Champion Roster" : "The Verdict · 82-Game Season"}
          </Kicker>
          <span className="stat-figure relative text-7xl leading-none sm:text-8xl">
            {score.wins}
            <span className="text-muted-foreground">–</span>
            {score.losses}
          </span>
          <span className="relative font-display text-sm italic text-muted-foreground">
            {verdictCaption(score.wins)}
          </span>
        </div>

        <div className="flex flex-col">
          <div className="flex items-center justify-between">
            <Kicker tone="muted">By the Numbers</Kicker>
            <span className="kicker text-muted-foreground">Contribution</span>
          </div>
          <Rule className="my-3" />
          <div className="flex flex-col gap-2.5">
            {rows.map((row) => (
              <ResultPlayerRow key={row.breakdown.position_slot} row={row} />
            ))}
          </div>
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
  const { breakdown, eraLabel, franchiseName, franchiseAbbr, contributionPct } = row
  const { metrics } = breakdown
  const teamColor = getTeamColor(franchiseAbbr)

  return (
    <div
      className="flex items-center gap-3 rounded-sm border border-l-[3px] border-border/70 p-2.5"
      style={teamColor ? { borderLeftColor: withAlpha(teamColor, 0.7) } : undefined}
    >
      <HalftoneAvatar
        src={headshotUrl(breakdown.player_id)}
        alt={breakdown.name}
        crossOrigin="anonymous"
        size={48}
        active
        accent={teamColor ?? undefined}
        className="rounded-sm"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="px-1.5 py-0">
            {breakdown.position_slot}
          </Badge>
          <span className="truncate font-display text-sm font-semibold">
            {breakdown.name}
          </span>
        </div>
        <span className="kicker text-muted-foreground">
          {[eraLabel, franchiseName].filter(Boolean).join(" · ")}
        </span>
        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[0.72rem] tabular-nums">
          <Metric label="WS/48" value={threeDp(metrics.ws_per_48)} />
          <Metric label="BPM" value={signed(metrics.bpm)} />
          <Metric label="VORP" value={oneDp(metrics.vorp)} />
          <Metric label="TS" value={pct(metrics.ts_pct)} />
        </div>
      </div>
      {/* Contribution share — a squared, printed meter (no pill), vermillion
          only for the team's leading contributor. */}
      <div className="flex w-16 shrink-0 flex-col items-end gap-1">
        <span className="stat-figure text-lg">{contributionPct.toFixed(0)}%</span>
        <span className="h-1 w-full overflow-hidden rounded-[1px] bg-muted">
          <span
            className={cn(
              "block h-full",
              row.isTopContributor ? "bg-primary" : "bg-foreground/35"
            )}
            style={{ width: `${Math.min(100, contributionPct)}%` }}
          />
        </span>
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="font-condensed font-bold uppercase tracking-[0.08em] text-muted-foreground/70">
        {label}
      </span>
      <span className="font-display font-semibold text-foreground">{value}</span>
    </span>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex w-full flex-col items-center gap-3 rounded-sm border bg-card p-10 text-center">
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
