// PlayerPoolPanel (WO-52) — the drawn pool as a single-column almanac stat
// table: printed headshot, name, then a box-score strip whose column heads
// double as the sort control. Team identity rides on the team-accented headshot
// only (no color spine). Players with no eligible open slot are greyed and
// tagged; Re-spin unlocks only when no one in the pool fits an open slot.
import * as React from "react"
import { ArrowDown, RotateCw } from "lucide-react"

import {
  DraftSlot,
  PlayerPoolEntry,
  PlayerPoolStats,
  headshotUrl,
  isPlayerUnselectable,
} from "@/lib/draft"
import { getTeamColor } from "@/lib/teamColors"
import { cn } from "@/lib/utils"
import { HalftoneAvatar, Kicker, Rule } from "@/components/editorial"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

interface PlayerPoolPanelProps {
  players: PlayerPoolEntry[]
  lineup: DraftSlot[]
  selectedPlayer: PlayerPoolEntry | null
  franchiseAbbr: string
  onSelect: (player: PlayerPoolEntry | null) => void
  onRespin: () => void
}

// Box-score columns, in almanac order. Counting stats are sortable (higher is
// better); FG% rides along for reference but isn't a sort key. No advanced
// metrics — WS/48 ranks the pool, so surfacing it would give away the answer.
type SortKey = "ppg" | "rpg" | "apg" | "spg" | "bpg"

const STAT_COLUMNS: {
  key: keyof PlayerPoolStats
  label: string
  sortable: boolean
}[] = [
  { key: "ppg", label: "PTS", sortable: true },
  { key: "rpg", label: "REB", sortable: true },
  { key: "apg", label: "AST", sortable: true },
  { key: "spg", label: "STL", sortable: true },
  { key: "bpg", label: "BLK", sortable: true },
  { key: "fg_pct", label: "FG%", sortable: false },
]

// Avatar · name · stat columns, shared by the header and every row so the
// figures line up as a printed table. On phones only the first three counting
// stats fit beside a readable name, so the grid drops to three columns and the
// trailing stats hide (see MOBILE_STAT_COLUMNS); from sm up all six show.
const MOBILE_STAT_COLUMNS = 3
const GRID_TEMPLATE =
  "grid-cols-[2.25rem_minmax(0,1fr)_repeat(3,2.75rem)] sm:grid-cols-[2.5rem_minmax(0,1fr)_repeat(6,3.25rem)]"

export function PlayerPoolPanel({
  players,
  lineup,
  selectedPlayer,
  franchiseAbbr,
  onSelect,
  onRespin,
}: PlayerPoolPanelProps) {
  const [sortKey, setSortKey] = React.useState<SortKey>("ppg")

  const allUnselectable =
    players.length > 0 && players.every((p) => isPlayerUnselectable(lineup, p))
  const teamColor = getTeamColor(franchiseAbbr)

  // Sort by the chosen stat (descending — best first).
  const visible = React.useMemo(
    () => [...players].sort((a, b) => b.stats[sortKey] - a.stats[sortKey]),
    [players, sortKey]
  )

  return (
    <div className="flex flex-col gap-3 rounded-sm border bg-card p-4">
      {/* The title shares the table header row: "The Pool" sits over the
          name column and the stat heads double as the sort control. A
          fixed-width arrow slot keeps each label from shifting when active. */}
      <div
        className={cn(
          "grid items-end gap-x-2 px-2.5 sm:gap-x-3",
          GRID_TEMPLATE
        )}
      >
        <Kicker className="col-span-2">Select a player</Kicker>
        {STAT_COLUMNS.map((col, idx) => {
          const active = col.sortable && sortKey === col.key
          const hideOnPhone = idx >= MOBILE_STAT_COLUMNS && "hidden sm:flex"
          return col.sortable ? (
            <button
              key={col.key}
              type="button"
              onClick={() => setSortKey(col.key as SortKey)}
              aria-pressed={active}
              className={cn(
                "kicker flex items-center justify-end transition-colors",
                active ? "text-primary" : "text-muted-foreground",
                hideOnPhone
              )}
            >
              {col.label}
              <ArrowDown
                className={cn("ml-0.5 h-3 w-3 shrink-0", !active && "invisible")}
                aria-hidden
              />
            </button>
          ) : (
            <span
              key={col.key}
              className={cn(
                "kicker flex items-center justify-end text-muted-foreground/70",
                hideOnPhone
              )}
            >
              {col.label}
              <span className="ml-0.5 h-3 w-3 shrink-0" aria-hidden />
            </span>
          )
        })}
      </div>
      <Rule />

      <div className="flex max-h-[26rem] flex-col gap-1 overflow-y-auto">
        {visible.map((player) => {
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
                "grid items-center gap-x-2 rounded-sm border bg-card/70 px-2.5 py-2 text-left transition-colors sm:gap-x-3",
                GRID_TEMPLATE,
                selected
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/60",
                unselectable && "cursor-not-allowed opacity-55 hover:border-border"
              )}
            >
              <HalftoneAvatar
                src={headshotUrl(player.player_id)}
                alt={player.name}
                size={34}
                active={!unselectable}
                accent={teamColor ?? undefined}
                className="rounded-sm"
              />
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate font-display text-base font-semibold leading-tight">
                  {player.name}
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  {unselectable ? (
                    <span className="kicker text-muted-foreground/80">
                      No slot
                    </span>
                  ) : (
                    player.positions.map((pos) => (
                      <Badge
                        key={pos}
                        variant={selected ? "default" : "secondary"}
                        className="px-1.5 py-0"
                      >
                        {pos}
                      </Badge>
                    ))
                  )}
                </span>
              </div>
              {STAT_COLUMNS.map((col, idx) => (
                <span
                  key={col.key}
                  className={cn(
                    "flex items-center justify-end font-display text-sm font-bold tabular-nums leading-none",
                    col.sortable && sortKey === col.key
                      ? "text-primary"
                      : "text-foreground",
                    !col.sortable && "text-muted-foreground",
                    idx >= MOBILE_STAT_COLUMNS && "hidden sm:flex"
                  )}
                >
                  {col.key === "fg_pct"
                    ? pct(player.stats.fg_pct)
                    : oneDp(player.stats[col.key])}
                  {/* Spacer matches the header's sort-arrow slot so figures
                      line up under their column label. */}
                  <span className="ml-0.5 h-3 w-3 shrink-0" aria-hidden />
                </span>
              ))}
            </button>
          )
        })}
      </div>

      {/* Re-spin only appears when nobody in the pool fits an open slot —
          otherwise the pick is on the user, not a dead draw. */}
      {allUnselectable && (
        <Button
          variant="outline"
          onClick={onRespin}
          className="w-full font-condensed font-bold uppercase tracking-[0.14em]"
        >
          <RotateCw className="h-4 w-4" />
          No one fits — re-spin
        </Button>
      )}
    </div>
  )
}

function oneDp(value: number): string {
  return value.toFixed(1)
}

function pct(value: number): string {
  // fg_pct is a 0..1 rate; show as a leading-dot figure (.485) like Bball Ref.
  return value.toFixed(3).replace(/^0\./, ".").replace(/^-0\./, "-.")
}
