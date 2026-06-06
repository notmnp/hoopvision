// PlacementSheet — the touch-first way to drop a drawn player into the lineup.
//
// On desktop the player pool sits beside the Starting Five board, so selecting a
// player and tapping an eligible row is one glance. On mobile the board is a long
// scroll away, so selection instead raises this bottom sheet: pick the player,
// choose an open slot they're eligible for, done. Styled as an almanac call-out —
// halftone headshot, ruled kicker, big Fraunces position numerals — to match the
// rest of the draft, never a generic modal.
import * as React from "react"
import { ChevronRight } from "lucide-react"

import {
  DraftSlot,
  PlayerPoolEntry,
  POSITION_LABEL,
  PositionSlot,
  eligibleOpenSlots,
  headshotUrl,
} from "@/lib/draft"
import { getTeamColor } from "@/lib/teamColors"
import { HalftoneAvatar, Kicker, Rule } from "@/components/editorial"
import { Badge } from "@/components/ui/badge"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"

interface PlacementSheetProps {
  open: boolean
  player: PlayerPoolEntry | null
  lineup: DraftSlot[]
  franchiseAbbr?: string
  onOpenChange: (open: boolean) => void
  onPlace: (position: PositionSlot, player: PlayerPoolEntry) => void
}

export function PlacementSheet({
  open,
  player,
  lineup,
  franchiseAbbr,
  onOpenChange,
  onPlace,
}: PlacementSheetProps) {
  // Freeze the last real player so the header/slots don't blank out mid close
  // animation (the parent clears the selection the instant a pick is made).
  const [shown, setShown] = React.useState<PlayerPoolEntry | null>(player)
  React.useEffect(() => {
    if (player) setShown(player)
  }, [player])

  const teamColor = franchiseAbbr ? getTeamColor(franchiseAbbr) : null
  const slots = shown ? eligibleOpenSlots(lineup, shown) : []

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="gap-0 rounded-t-sm border-t-2 bg-card p-0 pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        <SheetHeader className="gap-3 p-4 pb-3">
          <Kicker ruled>Make the pick</Kicker>
          <div className="flex items-center gap-3">
            <HalftoneAvatar
              src={shown ? headshotUrl(shown.player_id) : undefined}
              alt={shown?.name ?? ""}
              size={48}
              active
              accent={teamColor ?? undefined}
              className="rounded-sm"
            />
            <div className="flex min-w-0 flex-col gap-1">
              <SheetTitle className="truncate font-display text-xl font-semibold leading-tight">
                {shown?.name}
              </SheetTitle>
              <span className="flex flex-wrap items-center gap-1">
                {shown?.positions.map((pos) => (
                  <Badge key={pos} variant="secondary" className="px-1.5 py-0">
                    {pos}
                  </Badge>
                ))}
              </span>
            </div>
          </div>
        </SheetHeader>

        <Rule />

        <div className="flex flex-col gap-2 p-4">
          <Kicker tone="muted">
            {slots.length > 1 ? "Place at" : "Place at the open slot"}
          </Kicker>
          <div className="grid gap-2">
            {slots.map((position) => (
              <button
                key={position}
                type="button"
                onClick={() => shown && onPlace(position, shown)}
                className="group flex items-center gap-3 rounded-sm border border-border bg-card/70 px-3 py-3 text-left transition-colors hover:border-primary/60 active:bg-primary/10"
              >
                <span className="w-9 shrink-0 font-display text-3xl font-black leading-none tabular-nums text-primary">
                  {position}
                </span>
                <Rule vertical className="self-stretch" />
                <span className="kicker flex-1 text-foreground">
                  {POSITION_LABEL[position]}
                </span>
                <ChevronRight
                  className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
                  aria-hidden
                />
              </button>
            ))}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
