import { forwardRef } from "react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, act } from "@testing-library/react"

import type { SpinResult } from "@/components/SpinnerPanel"
import type { PlayerPoolEntry } from "@/lib/draft"

// Capture the props the workspace hands the spinner each render. `excludeIds` is
// exactly the session exclude list, so the mock renders it for assertions, and
// onSpinStart/onResolved let us script spins without animation or network.
const spinner = vi.hoisted(() => ({
  props: null as
    | null
    | {
        excludeIds: number[]
        onSpinStart: () => void
        onResolved: (r: SpinResult) => void
      },
}))

vi.mock("@/components/SpinnerPanel", () => ({
  // forwardRef because the workspace hands SpinnerPanel a ref (its spin handle).
  SpinnerPanel: forwardRef(function MockSpinner(props: NonNullable<typeof spinner.props>, _ref) {
    spinner.props = props
    return <div data-testid="exclude-ids">{props.excludeIds.join(",")}</div>
  }),
}))

// Desktop layout places via the board; stub out the mobile bottom sheet.
vi.mock("@/components/PlacementSheet", () => ({
  PlacementSheet: () => null,
}))

import DraftWorkspace from "@/pages/DraftWorkspace"

function player(id: number, name: string, positions: string[]): PlayerPoolEntry {
  return {
    player_id: id,
    season_id: `${id}-s`,
    name,
    positions,
    stats: { ppg: 20, apg: 5, rpg: 5, spg: 1, bpg: 1, fg_pct: 0.5, ws_per_48: 0.2 },
  }
}

function spin(combo: string, abbr: string, players: PlayerPoolEntry[]): SpinResult {
  return {
    eraId: combo,
    eraLabel: combo.toUpperCase(),
    franchiseId: abbr.toLowerCase(),
    franchiseName: abbr,
    franchiseAbbr: abbr,
    comboKey: `${combo}|${abbr.toLowerCase()}`,
    players,
  }
}

// Fire a spin: onSpinStart (phase→spinning) then onResolved (phase→placement).
function resolveSpin(result: SpinResult) {
  act(() => spinner.props!.onSpinStart())
  act(() => spinner.props!.onResolved(result))
}

function excludeIds(): string {
  return screen.getByTestId("exclude-ids").textContent ?? ""
}

// Select a player in the pool, then place them at a slot on the board.
function draft(name: RegExp, slot: string) {
  fireEvent.click(screen.getByRole("button", { name }))
  fireEvent.click(
    screen.getByRole("button", { name: new RegExp(`Place selected player at ${slot}`) })
  )
}

beforeEach(() => {
  spinner.props = null
})

describe("draft session player exclusion", () => {
  it("does NOT exclude players merely surfaced in a pool", () => {
    render(<DraftWorkspace />)
    expect(excludeIds()).toBe("")

    // Land on a team and see its pool — but draft nobody.
    resolveSpin(
      spin("90s", "BULLS", [
        player(1, "Jordan", ["SG"]),
        player(2, "Pippen", ["SF"]),
      ])
    )

    // The new contract: surfacing a player leaves them free for later combos.
    expect(excludeIds()).toBe("")
  })

  it("excludes ONLY the player you draft, not their poolmates", () => {
    render(<DraftWorkspace />)
    resolveSpin(
      spin("90s", "BULLS", [
        player(1, "Jordan", ["PG"]),
        player(2, "Pippen", ["SF"]),
      ])
    )

    draft(/Jordan/, "PG")

    // Jordan is retired; Pippen (surfaced, unpicked) stays available.
    expect(excludeIds()).toBe("1")
  })

  it("lets an unpicked player reappear on another combo and be drafted there", () => {
    render(<DraftWorkspace />)

    // See Jordan on the Bulls, walk away.
    resolveSpin(spin("90s", "BULLS", [player(1, "Jordan", ["PG"])]))
    expect(excludeIds()).toBe("")

    // Land on the Wizards, where Jordan appears again — draft him here.
    resolveSpin(spin("00s", "WIZARDS", [player(1, "Jordan", ["PG"])]))
    draft(/Jordan/, "PG")

    expect(excludeIds()).toBe("1")
    // And his lineup card credits the franchise he was actually drafted from.
    expect(screen.getByText(/WIZARDS/)).toBeTruthy()
  })
})
