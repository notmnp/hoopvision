import { useEffect, useRef } from "react"
import { CalendarDays, Plus, X } from "lucide-react"

import {
  BracketSlot,
  EMPTY_SLOT,
  headshotUrl,
  standardSeedOrder,
} from "@/lib/bracket"
import { BracketTree } from "@/components/BracketTree"
import { PlayerSearchCombobox } from "@/components/PlayerSearchCombobox"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { PlayerProfile } from "@/hooks/usePlayerSearch"
import { usePlayerSeasons } from "@/hooks/usePlayerSeasons"

// A first-round pairing references the two seeds (1-based) that face off. Later
// rounds carry no seeds — they're rendered as empty "to be decided" cells.
interface SetupMatchup {
  seed_a: number | null
  seed_b: number | null
}

// Builds the bracket-shaped round structure for the setup tree: round 1 carries
// the seed pairings from the standard seed order; later rounds are placeholders
// sized to the tree so the BracketTree can lay out the full NBA-style fan.
function buildSetupRounds(size: number) {
  const order = standardSeedOrder(size)
  const firstRound: SetupMatchup[] = []
  for (let i = 0; i < order.length; i += 2) {
    firstRound.push({ seed_a: order[i], seed_b: order[i + 1] })
  }

  const rounds = [{ round_number: 1, matchups: firstRound }]
  const totalRounds = Math.round(Math.log2(size))
  for (let r = 2; r <= totalRounds; r++) {
    const count = size / 2 ** r
    rounds.push({
      round_number: r,
      matchups: Array.from({ length: count }, () => ({
        seed_a: null,
        seed_b: null,
      })),
    })
  }
  return rounds
}

// The setup-phase body: an editable NBA-style bracket whose first-round cells
// are player pickers and whose later rounds are "Awaiting winner" placeholders.
export function BracketBuilder({
  size,
  slots,
  onUpdateSlot,
  disabled,
}: {
  size: number
  slots: BracketSlot[]
  onUpdateSlot: (index: number, slot: BracketSlot) => void
  disabled?: boolean
}) {
  const rounds = buildSetupRounds(size)

  return (
    <div className="overflow-x-auto pb-4">
      <BracketTree
        rounds={rounds}
        renderMatchup={(matchup, ctx) => {
          if (ctx.roundNumber !== 1) {
            return <PlaceholderMatchup />
          }
          const indexA = (matchup.seed_a as number) - 1
          const indexB = (matchup.seed_b as number) - 1
          return (
            <div className="rounded-lg border bg-card shadow-sm">
              <SlotPicker
                slot={slots[indexA]}
                onChange={(next) => onUpdateSlot(indexA, next)}
                disabled={disabled}
                ariaLabel={`Pick player for seed ${matchup.seed_a}`}
              />
              <div className="border-t" />
              <SlotPicker
                slot={slots[indexB]}
                onChange={(next) => onUpdateSlot(indexB, next)}
                disabled={disabled}
                ariaLabel={`Pick player for seed ${matchup.seed_b}`}
              />
            </div>
          )
        }}
      />
    </div>
  )
}

// An empty cell for a not-yet-decided matchup in rounds beyond the first.
function PlaceholderMatchup() {
  return (
    <div className="rounded-lg border border-dashed bg-muted/20 shadow-sm">
      <PlaceholderRow />
      <div className="border-t border-dashed" />
      <PlaceholderRow />
    </div>
  )
}

function PlaceholderRow() {
  return (
    <div className="flex items-center gap-2.5 p-2.5 text-sm text-muted-foreground">
      <div className="h-9 w-9 shrink-0 rounded-md border border-dashed bg-muted/40" />
      <span className="italic">Awaiting winner</span>
    </div>
  )
}

// A single editable participant row used as the two rows of every first-round
// matchup card. Empty slots show a "Select player" affordance that opens the
// shared click-to-open combobox; filled slots show the player and a season
// selector.
function SlotPicker({
  slot,
  onChange,
  disabled,
  ariaLabel,
}: {
  slot: BracketSlot
  onChange: (slot: BracketSlot) => void
  disabled?: boolean
  ariaLabel: string
}) {
  const { seasons, loading: seasonsLoading, loadSeasons } = usePlayerSeasons()
  const loadedForPlayer = useRef<number | null>(null)

  // Whenever a player is set (via the combobox or a loaded default), make sure
  // that player's season list is available so the season selector is populated.
  useEffect(() => {
    if (slot.player_id !== null && loadedForPlayer.current !== slot.player_id) {
      loadedForPlayer.current = slot.player_id
      loadSeasons(slot.player_id)
    }
    if (slot.player_id === null) {
      loadedForPlayer.current = null
    }
  }, [slot.player_id, loadSeasons])

  async function confirmPlayer(profile: PlayerProfile) {
    const loaded = await loadSeasons(profile.player_id)
    loadedForPlayer.current = profile.player_id
    const mostRecent = loaded?.[0]?.season_id ?? null
    onChange({
      player_id: profile.player_id,
      name: profile.name,
      season_id: mostRecent,
    })
  }

  function clearSlot() {
    onChange({ ...EMPTY_SLOT })
  }

  if (slot.player_id !== null) {
    return (
      <div className="flex items-center gap-2.5 p-2.5">
        {/* Plain <img> (not the Radix Avatar) with crossOrigin="anonymous" so it
            loads via our CORS proxy and stays consistent with the bracket board
            (ADR-006); Radix Avatar.Image's load detection fails for these. The
            initials sit underneath and show through if the photo errors. */}
        <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-md border bg-muted">
          <span className="flex h-full w-full items-center justify-center text-[10px] font-semibold text-muted-foreground">
            {slot.name ? getInitials(slot.name) : "?"}
          </span>
          <img
            src={headshotUrl(slot.player_id)}
            alt={slot.name ?? ""}
            crossOrigin="anonymous"
            loading="eager"
            onError={(event) => {
              event.currentTarget.style.visibility = "hidden"
            }}
            className="absolute inset-0 h-full w-full object-cover object-top"
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">
            {slot.name ?? `Player #${slot.player_id}`}
          </div>
          <Select
            value={slot.season_id ?? undefined}
            onValueChange={(value) => onChange({ ...slot, season_id: value })}
            disabled={disabled || seasonsLoading || seasons.length === 0}
          >
            <SelectTrigger
              aria-label={`Select season — ${slot.name ?? "player"}`}
              className="mt-0 h-5! gap-1.5 border-none bg-transparent px-0 py-0! text-xs text-muted-foreground shadow-none focus:ring-0"
            >
              <CalendarDays className="h-3.5 w-3.5" />
              <SelectValue
                placeholder={seasonsLoading ? "Loading seasons…" : "Select a season"}
              />
            </SelectTrigger>
            <SelectContent position="popper" className="max-h-64">
              {seasons.map((season) => (
                <SelectItem key={season.season_id} value={season.season_id}>
                  {season.season_label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-muted-foreground"
          onClick={clearSlot}
          disabled={disabled}
          aria-label="Clear player"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    )
  }

  return (
    <PlayerSearchCombobox
      disabled={disabled}
      onSelect={confirmPlayer}
      trigger={
        <button
          type="button"
          disabled={disabled}
          aria-label={ariaLabel}
          className="flex w-full items-center gap-2.5 p-2.5 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-dashed bg-muted/40">
            <Plus className="h-4 w-4 opacity-60" />
          </span>
          <span>Select player</span>
        </button>
      }
    />
  )
}

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
}
