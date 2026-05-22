import { FormEvent, useState } from "react"
import { AlertTriangle, Loader2, Search, Swords, UserRound } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  PlayerProfile,
  usePlayerSearch,
} from "@/hooks/usePlayerSearch"

type SlotLabel = "Player A" | "Player B"

interface PlayerSlotProps {
  label: SlotLabel
  selectedPlayer: PlayerProfile | null
  onSelect: (player: PlayerProfile) => void
  onClear: () => void
}

function PlayerSelectionController() {
  const [playerA, setPlayerA] = useState<PlayerProfile | null>(null)
  const [playerB, setPlayerB] = useState<PlayerProfile | null>(null)
  const canRunSimulation = Boolean(playerA && playerB)

  return (
    <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-screen-xl flex-col px-4 py-6 md:px-6">
      <div className="mb-6 flex flex-col gap-3 border-b pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">ISO Simulator</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Select two players to stage a 1v1 matchup.
          </p>
        </div>
        <Button disabled={!canRunSimulation} className="w-full md:w-auto">
          <Swords className="h-4 w-4" />
          Run Simulation
        </Button>
      </div>

      <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-[1fr_auto_1fr] lg:items-start">
        <PlayerSlot
          label="Player A"
          selectedPlayer={playerA}
          onSelect={setPlayerA}
          onClear={() => setPlayerA(null)}
        />
        <div className="hidden h-full items-center justify-center lg:flex">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border bg-muted text-sm font-semibold">
            VS
          </div>
        </div>
        <PlayerSlot
          label="Player B"
          selectedPlayer={playerB}
          onSelect={setPlayerB}
          onClear={() => setPlayerB(null)}
        />
      </div>
    </div>
  )
}

function PlayerSlot({
  label,
  selectedPlayer,
  onSelect,
  onClear,
}: PlayerSlotProps) {
  const [query, setQuery] = useState("")
  const { player, loading, error, searchPlayer, clearPlayer } = usePlayerSearch()

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const result = await searchPlayer(query)
    if (result) {
      onSelect(result)
    }
  }

  function handleClear() {
    clearPlayer()
    setQuery("")
    onClear()
  }

  const profile = selectedPlayer ?? player

  return (
    <Card className="min-h-[32rem] rounded-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <UserRound className="h-4 w-4" />
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search player"
            className="h-10 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm outline-none ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
          <Button type="submit" size="icon" disabled={loading}>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
          </Button>
        </form>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {profile ? (
          <div className="space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-2xl font-semibold leading-tight">
                  {profile.name}
                </h2>
                <div className="mt-2 flex flex-wrap gap-2">
                  {profile.position && <Badge>{profile.position}</Badge>}
                  {profile.team && <Badge variant="secondary">{profile.team}</Badge>}
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={handleClear}>
                Clear
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Attribute label="Height" value={profile.height ?? "N/A"} />
              <Attribute label="Weight" value={formatWeight(profile.weight)} />
              <Attribute
                label="Wingspan"
                value={formatWingspan(profile.wingspan)}
              />
              <Attribute
                label="Career"
                value={formatCareer(profile.from_year, profile.to_year)}
              />
            </div>

            <div className="grid grid-cols-3 gap-3 border-t pt-4">
              <Stat label="PTS" value={profile.headline_stats.points} />
              <Stat label="REB" value={profile.headline_stats.rebounds} />
              <Stat label="AST" value={profile.headline_stats.assists} />
            </div>

            {profile.data_warnings.length > 0 && (
              <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="space-y-1">
                  {profile.data_warnings.map((warning) => (
                    <p key={warning}>{warning}</p>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex min-h-72 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
            No player selected
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function Attribute({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-semibold">{value}</div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold">
        {typeof value === "number" ? value.toFixed(1) : "N/A"}
      </div>
    </div>
  )
}

function formatWeight(weight: string | null) {
  return weight ? `${weight} lb` : "N/A"
}

function formatWingspan(wingspan: number | null) {
  return typeof wingspan === "number" ? `${wingspan.toFixed(1)} in` : "N/A"
}

function formatCareer(
  fromYear: string | number | null,
  toYear: string | number | null
) {
  if (!fromYear && !toYear) {
    return "N/A"
  }
  return `${fromYear ?? "?"}-${toYear ?? "?"}`
}

const SimulatorView = PlayerSelectionController

export default SimulatorView
