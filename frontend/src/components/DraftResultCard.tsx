// WO-51 placeholder. WO-53 builds the full result card: prominent record,
// contribution breakdown, html2canvas-pro share export, and polish. This stub
// covers the loading / error / resolved states and the Play Again reset so the
// DraftWorkspace result phase is wired end-to-end.
import { AlertTriangle, Loader2, RotateCcw } from "lucide-react"

import { DraftScore, DraftSlot } from "@/lib/draft"
import { Button } from "@/components/ui/button"

interface DraftResultCardProps {
  lineup: DraftSlot[]
  score: DraftScore | null
  loading: boolean
  error: string | null
  onRetry: () => void
  onPlayAgain: () => void
}

export function DraftResultCard({
  score,
  loading,
  error,
  onRetry,
  onPlayAgain,
}: DraftResultCardProps) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-sm border bg-card p-8 text-center">
      {loading && (
        <>
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <p className="kicker text-muted-foreground">Simulating the season…</p>
        </>
      )}

      {!loading && error && (
        <>
          <AlertTriangle className="h-6 w-6 text-destructive" />
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button
            variant="outline"
            onClick={onRetry}
            className="font-condensed font-bold uppercase tracking-[0.14em]"
          >
            Try again
          </Button>
        </>
      )}

      {!loading && !error && score && (
        <>
          <span className="display text-6xl tabular-nums">
            {score.wins}–{score.losses}
          </span>
          <p className="kicker text-muted-foreground">Projected 82-game record</p>
          <Button
            onClick={onPlayAgain}
            className="mt-2 font-condensed font-bold uppercase tracking-[0.14em]"
          >
            <RotateCcw className="h-4 w-4" />
            Play again
          </Button>
        </>
      )}
    </div>
  )
}
