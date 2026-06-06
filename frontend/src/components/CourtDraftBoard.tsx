// The drafted lineup, as an editorial "Starting Five" roster card (WO-52).
//
// Deliberately NOT a basketball-court diagram: DESIGN.md bans the literal
// court-line backdrop as the #1 AI-sports cliché. Instead this is an almanac
// depth-chart — five position rows, hairline-separated, each an empty slot or a
// printed (duotone) headshot with the player's name and the era/franchise they
// were drawn from. Selecting a player highlights every open row they're
// eligible for; tapping a highlighted row confirms the placement.
import {
  DraftSlot,
  PlayerPoolEntry,
  POSITION_LABEL,
  PositionSlot,
  eligibleOpenSlots,
  headshotUrl,
} from "@/lib/draft"
import { getTeamColor } from "@/lib/teamColors"
import { cn } from "@/lib/utils"
import { HalftoneAvatar, Kicker, Rule } from "@/components/editorial"

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
  const eligible = selectedPlayer
    ? new Set(eligibleOpenSlots(lineup, selectedPlayer))
    : new Set<PositionSlot>()
  const filled = lineup.filter((slot) => slot.pick !== null).length

  return (
    <div className="relative flex flex-col overflow-hidden rounded-sm border bg-card p-4 sm:p-5">
      {/* Faint oversized watermark for editorial atmosphere — never court lines. */}
      <span
        aria-hidden
        className="pointer-events-none absolute -right-4 bottom-0 select-none font-display text-[9rem] font-black italic leading-none text-foreground/[0.04]"
      >
        5
      </span>

      <div className="relative mb-3 flex items-center justify-between">
        <Kicker ruled>Starting Five</Kicker>
        <span className="kicker tabular-nums text-muted-foreground">
          {filled} / 5
        </span>
      </div>

      <div className="relative divide-y divide-border overflow-hidden rounded-sm border">
        {lineup.map((slot) => (
          <LineupRow
            key={slot.position}
            slot={slot}
            highlighted={eligible.has(slot.position)}
            onPlace={() =>
              selectedPlayer &&
              eligible.has(slot.position) &&
              onPlace(slot.position, selectedPlayer)
            }
          />
        ))}
      </div>
    </div>
  )
}

function LineupRow({
  slot,
  highlighted,
  onPlace,
}: {
  slot: DraftSlot
  highlighted: boolean
  onPlace: () => void
}) {
  const pick = slot.pick
  const teamColor = pick ? getTeamColor(pick.franchiseAbbr) : null

  return (
    <button
      type="button"
      disabled={!highlighted}
      aria-label={
        highlighted
          ? `Place selected player at ${slot.position}`
          : pick
            ? `${slot.position}: ${pick.player.name}`
            : `${slot.position} — empty`
      }
      onClick={onPlace}
      className={cn(
        // Fixed row height so an empty slot is the same height as a filled one
        // (40px headshot + padding) — placing a player never restretches the row.
        "flex min-h-[3.75rem] w-full items-center gap-3 px-3 py-2.5 text-left transition-colors",
        highlighted
          ? "cursor-pointer bg-primary/10 hover:bg-primary/15"
          : "cursor-default"
      )}
    >
      {pick ? (
        // Filled slot: just the player — printed headshot, name, where they came
        // from. No position acronym (the slot is settled).
        <>
          <HalftoneAvatar
            src={headshotUrl(pick.player.player_id)}
            alt={pick.player.name}
            size={40}
            active
            accent={teamColor ?? undefined}
            className="rounded-sm"
          />
          <div className="min-w-0 flex-1">
            <span className="block truncate font-display text-sm font-semibold leading-tight">
              {pick.player.name}
            </span>
            <span className="kicker text-muted-foreground">
              {pick.eraLabel} · {pick.franchiseName}
            </span>
          </div>
        </>
      ) : (
        // Open slot: the position rail + label.
        <>
          <span
            className={cn(
              "w-8 shrink-0 font-display text-2xl font-black leading-none tabular-nums",
              highlighted ? "text-primary" : "text-muted-foreground/45"
            )}
          >
            {slot.position}
          </span>
          <Rule vertical className="self-stretch" />
          <span
            className={cn(
              "kicker",
              highlighted ? "text-primary" : "text-muted-foreground/70"
            )}
          >
            {highlighted ? "Tap to place" : POSITION_LABEL[slot.position]}
          </span>
        </>
      )}
    </button>
  )
}
