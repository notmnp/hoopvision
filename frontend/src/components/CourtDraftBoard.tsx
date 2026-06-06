// WO-51 placeholder. The full SVG half-court with positioned slot markers and
// eligibility highlighting is built in WO-52; this stub satisfies the
// DraftWorkspace integration contract so the state machine is exercisable.
import { DraftSlot, PlayerPoolEntry, PositionSlot, eligibleOpenSlots } from "@/lib/draft"
import { cn } from "@/lib/utils"

interface CourtDraftBoardProps {
  lineup: DraftSlot[]
  selectedPlayer: PlayerPoolEntry | null
  onPlace: (position: PositionSlot, player: PlayerPoolEntry) => void
}

export function CourtDraftBoard({
  lineup,
  selectedPlayer,
  onPlace,
}: CourtDraftBoardProps) {
  const highlighted = selectedPlayer
    ? new Set(eligibleOpenSlots(lineup, selectedPlayer))
    : new Set<PositionSlot>()

  return (
    <div className="grid grid-cols-5 gap-2 rounded-sm border bg-card p-4">
      {lineup.map((slot) => {
        const isHighlighted = highlighted.has(slot.position)
        return (
          <button
            key={slot.position}
            type="button"
            disabled={!isHighlighted}
            onClick={() =>
              selectedPlayer && isHighlighted && onPlace(slot.position, selectedPlayer)
            }
            className={cn(
              "flex aspect-square flex-col items-center justify-center rounded-sm border text-center",
              isHighlighted
                ? "border-primary bg-primary/10"
                : "border-border",
              !isHighlighted && "cursor-default"
            )}
          >
            <span className="kicker text-muted-foreground">{slot.position}</span>
            {slot.pick && (
              <span className="mt-1 px-1 text-xs font-medium leading-tight">
                {slot.pick.player.name}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
