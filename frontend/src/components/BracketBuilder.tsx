import { useEffect, useRef } from "react"
import { CalendarDays, Plus, X } from "lucide-react"

import {
  BracketSlot,
  EMPTY_SLOT,
  headshotUrl,
  participantLastName,
  standardSeedOrder,
} from "@/lib/bracket"
import { HalftoneAvatar } from "@/components/editorial"
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

// A first-round pairing: the two seeds (1-based) that face off in round one.
interface SeedPairing {
  seed_a: number
  seed_b: number
}

// The first-round matchups from the standard seed order (1v16, 8v9, …). The
// setup only ever seeds round one, so we never build the later rounds — they're
// produced server-side when the bracket runs.
function firstRoundPairings(size: number): SeedPairing[] {
  const order = standardSeedOrder(size)
  const pairs: SeedPairing[] = []
  for (let i = 0; i < order.length; i += 2) {
    pairs.push({ seed_a: order[i], seed_b: order[i + 1] })
  }
  return pairs
}

// The setup-phase body: a scroll-free, responsive grid of first-round matchup
// cards. Each card is one pairing (two seed slots). No tree, no horizontal
// scroll — even a 16-team field stays a tidy two-column list. This mirrors the
// running board's round-view matchup grid for a consistent mental model.
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
  const pairings = firstRoundPairings(size)

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {pairings.map((pair, i) => {
        const indexA = pair.seed_a - 1
        const indexB = pair.seed_b - 1
        return (
          <div
            key={i}
            className="overflow-hidden rounded-sm border bg-card"
          >
            <div className="flex items-center border-b bg-muted/30 px-2.5 py-1.5">
              <span className="kicker text-muted-foreground">
                Matchup {i + 1}
              </span>
            </div>
            <SlotPicker
              slot={slots[indexA]}
              onChange={(next) => onUpdateSlot(indexA, next)}
              disabled={disabled}
              seed={pair.seed_a}
              ariaLabel={`Pick player for seed ${pair.seed_a}`}
            />
            <div className="border-t" />
            <SlotPicker
              slot={slots[indexB]}
              onChange={(next) => onUpdateSlot(indexB, next)}
              disabled={disabled}
              seed={pair.seed_b}
              ariaLabel={`Pick player for seed ${pair.seed_b}`}
            />
          </div>
        )
      })}
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
  seed,
  ariaLabel,
}: {
  slot: BracketSlot
  onChange: (slot: BracketSlot) => void
  disabled?: boolean
  seed: number
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
        {/* HalftoneAvatar renders the proxied headshot as a duotone print
            cutout; its initials fallback shows if the photo errors. The setup
            tree isn't part of the PNG export, so crossOrigin isn't required
            here (unlike the running board's MatchupCard). */}
        <HalftoneAvatar
          src={headshotUrl(slot.player_id)}
          alt={slot.name ?? `Player #${slot.player_id}`}
          fallback={slot.name ? getInitials(slot.name) : "?"}
          size={36}
          active
        />
        <div className="min-w-0 flex-1">
          <div
            title={slot.name ?? `Player #${slot.player_id}`}
            className="line-clamp-2 font-display text-sm font-bold uppercase leading-tight tracking-tight text-foreground"
          >
            {participantLastName({ name: slot.name, player_id: slot.player_id })}
          </div>
          <Select
            value={slot.season_id ?? undefined}
            onValueChange={(value) => onChange({ ...slot, season_id: value })}
            disabled={disabled || seasonsLoading || seasons.length === 0}
          >
            <SelectTrigger
              aria-label={`Select season — ${slot.name ?? "player"}`}
              className="mt-0.5 h-5! gap-1.5 border-none bg-transparent px-0 py-0! font-condensed text-xs font-bold uppercase tracking-[0.14em] tabular-nums text-muted-foreground shadow-none focus:ring-0"
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
          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
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
          className="group relative flex w-full items-center gap-2.5 border border-dashed border-border bg-muted/10 p-2.5 text-left transition-colors hover:border-primary/60 hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {/* Faint Fraunces seed watermark behind the empty slot. */}
          <span
            aria-hidden
            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 font-display text-3xl font-black leading-none tabular-nums text-foreground/[0.06]"
          >
            {seed}
          </span>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-dashed border-border bg-muted/40 text-muted-foreground group-hover:border-primary/60 group-hover:text-primary">
            <Plus className="h-4 w-4" />
          </span>
          <span className="font-condensed text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground group-hover:text-foreground">
            Seed this slot
          </span>
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
