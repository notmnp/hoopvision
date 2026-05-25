import { Loader2 } from "lucide-react"

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"

export interface ShotChartTarget {
  playerId: number
  playerName: string
  seasonId: string
}

// Placeholder shell. The court diagram, zone encoding, interaction, and the
// lazy useShotChart fetch with the data-warning path are implemented in WO-38;
// TendencyComparisonPanel already wires its "View Shot Chart" trigger to this
// component so the integration point is stable.
export default function ShotChartSheet({
  target,
  onOpenChange,
}: {
  target: ShotChartTarget | null
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Sheet open={target !== null} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{target ? `${target.playerName} · ${target.seasonId}` : "Shot chart"}</SheetTitle>
          <SheetDescription>Shot chart</SheetDescription>
        </SheetHeader>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Shot chart coming soon.
        </div>
      </SheetContent>
    </Sheet>
  )
}
