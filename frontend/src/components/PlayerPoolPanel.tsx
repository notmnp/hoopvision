// WO-51 placeholder. WO-52 replaces this with the full pool cards (stats,
// position badges, greyed-out unselectables). This stub keeps the
// DraftWorkspace integration contract stable and the flow clickable.
import { RotateCw } from "lucide-react"

import {
  DraftSlot,
  PlayerPoolEntry,
  isPlayerUnselectable,
} from "@/lib/draft"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

interface PlayerPoolPanelProps {
  players: PlayerPoolEntry[]
  lineup: DraftSlot[]
  selectedPlayer: PlayerPoolEntry | null
  onSelect: (player: PlayerPoolEntry | null) => void
  onRespin: () => void
}

export function PlayerPoolPanel({
  players,
  lineup,
  selectedPlayer,
  onSelect,
  onRespin,
}: PlayerPoolPanelProps) {
  // Re-spin is only offered when no player in the pool can fill any open slot.
  const allUnselectable = players.every((p) => isPlayerUnselectable(lineup, p))

  return (
    <div className="flex flex-col gap-2 rounded-sm border bg-card p-4">
      {players.map((player) => {
        const unselectable = isPlayerUnselectable(lineup, player)
        const selected = selectedPlayer?.player_id === player.player_id
        return (
          <button
            key={player.player_id}
            type="button"
            disabled={unselectable}
            onClick={() => onSelect(selected ? null : player)}
            className={cn(
              "flex items-center justify-between gap-2 rounded-sm border px-3 py-2 text-left text-sm transition-colors",
              selected ? "border-primary bg-primary/10" : "border-border",
              unselectable && "opacity-40"
            )}
          >
            <span className="font-medium">{player.name}</span>
            <span className="kicker text-muted-foreground">
              {player.positions.join("/")}
            </span>
          </button>
        )
      })}
      {allUnselectable && (
        <Button
          variant="outline"
          onClick={onRespin}
          className="mt-1 font-condensed font-bold uppercase tracking-[0.14em]"
        >
          <RotateCw className="h-4 w-4" />
          Re-spin
        </Button>
      )}
    </div>
  )
}
