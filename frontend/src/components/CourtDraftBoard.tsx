// CourtDraftBoard (WO-52) — a half-court SVG with five fixed positional slots.
// Selecting a player in PlayerPoolPanel highlights every open slot they're
// eligible for; tapping a highlighted slot confirms the placement. Lineup
// completion is derived by DraftWorkspace once the fifth slot fills.
import { DraftSlot, PlayerPoolEntry, PositionSlot, eligibleOpenSlots } from "@/lib/draft"
import { cn } from "@/lib/utils"

interface CourtDraftBoardProps {
  lineup: DraftSlot[]
  selectedPlayer: PlayerPoolEntry | null
  onPlace: (position: PositionSlot, player: PlayerPoolEntry) => void
}

// Fixed slot coordinates within the 500×470 half-court (basket at top center):
// PG at the top of the key, SG/SF on the right/left wings, PF/C flanking the
// paint near the basket.
const SLOT_POSITIONS: Record<PositionSlot, { x: number; y: number }> = {
  C: { x: 150, y: 112 },
  PF: { x: 350, y: 112 },
  SF: { x: 92, y: 250 },
  SG: { x: 408, y: 250 },
  PG: { x: 250, y: 330 },
}

const SLOT_RADIUS = 38

function abbreviateName(name: string): { initial: string; surname: string } {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return { initial: "", surname: clip(parts[0]) }
  const surname = parts.slice(1).join(" ")
  return { initial: `${parts[0][0]}.`, surname: clip(surname) }
}

function clip(text: string): string {
  return text.length > 11 ? `${text.slice(0, 10)}…` : text
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
    <div className="flex flex-col rounded-sm border bg-card p-4">
      <svg
        viewBox="0 0 500 470"
        className="h-auto w-full"
        role="group"
        aria-label="Draft court — five positional slots"
      >
        {/* Court markings (decorative). */}
        <g fill="none" className="stroke-foreground/25" strokeWidth={2}>
          <rect x={12} y={12} width={476} height={446} rx={4} />
          {/* Paint / key, from the baseline down to the free-throw line. */}
          <rect x={180} y={12} width={140} height={188} />
          {/* Free-throw circle. */}
          <circle cx={250} cy={200} r={58} />
          {/* Three-point line: corner segments + arc around the basket. */}
          <path d="M40 12 L40 160 A237 237 0 0 0 460 160 L460 12" />
          {/* Backboard + rim. */}
          <line x1={214} y1={46} x2={286} y2={46} />
          <circle cx={250} cy={56} r={9} />
        </g>

        {lineup.map((slot) => (
          <SlotMarker
            key={slot.position}
            slot={slot}
            highlighted={highlighted.has(slot.position)}
            onPlace={() =>
              selectedPlayer &&
              highlighted.has(slot.position) &&
              onPlace(slot.position, selectedPlayer)
            }
          />
        ))}
      </svg>
    </div>
  )
}

function SlotMarker({
  slot,
  highlighted,
  onPlace,
}: {
  slot: DraftSlot
  highlighted: boolean
  onPlace: () => void
}) {
  const { x, y } = SLOT_POSITIONS[slot.position]
  const filled = slot.pick !== null
  const name = filled ? abbreviateName(slot.pick!.player.name) : null

  return (
    <g
      transform={`translate(${x} ${y})`}
      role={highlighted ? "button" : undefined}
      tabIndex={highlighted ? 0 : undefined}
      aria-label={
        highlighted
          ? `Place at ${slot.position}`
          : filled
            ? `${slot.position}: ${slot.pick!.player.name}`
            : `${slot.position} (empty)`
      }
      onClick={onPlace}
      onKeyDown={(event) => {
        if (highlighted && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault()
          onPlace()
        }
      }}
      className={cn(
        "outline-none",
        highlighted && "cursor-pointer [&_circle]:animate-pulse"
      )}
    >
      <circle
        r={SLOT_RADIUS}
        className={cn(
          "transition-colors",
          highlighted
            ? "fill-primary/15 stroke-primary"
            : filled
              ? "fill-secondary stroke-foreground/40"
              : "fill-background stroke-foreground/30"
        )}
        strokeWidth={highlighted ? 3 : 2}
      />
      {filled ? (
        <>
          {name!.initial && (
            <text
              textAnchor="middle"
              y={-6}
              className="fill-muted-foreground"
              style={{ fontSize: 11, fontWeight: 700 }}
            >
              {name!.initial}
            </text>
          )}
          <text
            textAnchor="middle"
            y={name!.initial ? 9 : 4}
            className="fill-foreground"
            style={{ fontSize: 12, fontWeight: 600 }}
          >
            {name!.surname}
          </text>
          <text
            textAnchor="middle"
            y={24}
            className="fill-muted-foreground"
            style={{ fontSize: 8, fontWeight: 700, letterSpacing: "0.08em" }}
          >
            {slot.position}
          </text>
        </>
      ) : (
        <text
          textAnchor="middle"
          y={6}
          className={highlighted ? "fill-primary" : "fill-muted-foreground"}
          style={{ fontSize: 17, fontWeight: 800, letterSpacing: "0.04em" }}
        >
          {slot.position}
        </text>
      )}
    </g>
  )
}
