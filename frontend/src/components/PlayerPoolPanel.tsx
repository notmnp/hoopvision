// PlayerPoolPanel (WO-52) — the spun pool as selectable stat cards. A player is
// greyed out when none of their eligible positions has an open slot left; the
// Re-spin action is only enabled when every player in the pool is unselectable.
import { RotateCw } from "lucide-react"

import {
  DraftSlot,
  PlayerPoolEntry,
  isPlayerUnselectable,
} from "@/lib/draft"
import { cn } from "@/lib/utils"
import { Kicker } from "@/components/editorial"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

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
  const allUnselectable =
    players.length > 0 && players.every((p) => isPlayerUnselectable(lineup, p))

  return (
    <div className="flex flex-col gap-3 rounded-sm border bg-card p-4">
      <div className="flex items-center justify-between">
        <Kicker tone="muted">Pick a player</Kicker>
        <span className="kicker tabular-nums text-muted-foreground">
          {players.length} available
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {players.map((player) => {
          const unselectable = isPlayerUnselectable(lineup, player)
          const selected = selectedPlayer?.player_id === player.player_id
          return (
            <button
              key={player.player_id}
              type="button"
              disabled={unselectable}
              aria-pressed={selected}
              onClick={() => onSelect(selected ? null : player)}
              className={cn(
                "flex flex-col gap-2 rounded-sm border p-3 text-left transition-colors",
                selected
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/60",
                unselectable && "cursor-not-allowed opacity-50 hover:border-border"
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-display text-base font-semibold leading-tight">
                  {player.name}
                </span>
                <span className="flex shrink-0 gap-1">
                  {player.positions.map((pos) => (
                    <Badge
                      key={pos}
                      variant={selected ? "default" : "secondary"}
                      className="px-1.5 py-0 text-[0.62rem]"
                    >
                      {pos}
                    </Badge>
                  ))}
                </span>
              </div>
              <div className="grid grid-cols-5 gap-1">
                <Stat label="PPG" value={oneDp(player.stats.ppg)} />
                <Stat label="APG" value={oneDp(player.stats.apg)} />
                <Stat label="RPG" value={oneDp(player.stats.rpg)} />
                <Stat label="WS/48" value={threeDp(player.stats.ws_per_48)} />
                <Stat label="BPM" value={oneDp(player.stats.bpm)} />
              </div>
            </button>
          )
        })}
      </div>

      <Tooltip>
        <TooltipTrigger asChild>
          <span className="flex">
            <Button
              variant="outline"
              onClick={onRespin}
              disabled={!allUnselectable}
              className="w-full font-condensed font-bold uppercase tracking-[0.14em]"
            >
              <RotateCw className="h-4 w-4" />
              Re-spin
            </Button>
          </span>
        </TooltipTrigger>
        {!allUnselectable && (
          <TooltipContent className="font-condensed text-xs font-bold uppercase tracking-[0.14em]">
            Re-spin unlocks when no one in the pool fits an open slot.
          </TooltipContent>
        )}
      </Tooltip>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="font-display text-sm font-semibold tabular-nums leading-none">
        {value}
      </span>
      <span className="text-[0.58rem] font-bold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </span>
    </div>
  )
}

function oneDp(value: number): string {
  return value.toFixed(1)
}

function threeDp(value: number): string {
  // WS/48 reads as a leading-dot figure (.321), matching Basketball Reference.
  return value.toFixed(3).replace(/^0\./, ".").replace(/^-0\./, "-.")
}
