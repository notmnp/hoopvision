import { ReactNode } from "react"
import { ArrowLeftRight, ScatterChart, TrendingUp } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { PlayerProfile } from "@/hooks/usePlayerSearch"
import { PlayerSeasonStats } from "@/hooks/usePlayerSeasons"

// TendencyComparisonPanel (Tendency Explorer). Renders a side-by-side breakdown
// of both confirmed players, sourced entirely from the PlayerProfile and
// PlayerSeasonStats already resolved by PlayerSelectionController — it issues no
// API calls of its own (ADR: data reuse). It surfaces key matchup differentials
// and a per-player "View Shot Chart" trigger that opens ShotChartSheet.
export interface TendencyComparisonPanelProps {
  playerA: PlayerProfile
  playerB: PlayerProfile
  seasonA: string
  seasonB: string
  statsA: PlayerSeasonStats
  statsB: PlayerSeasonStats
  onViewShotChart: (player: PlayerProfile, seasonId: string) => void
}

// Which side holds the advantage for a given row. `null` means even / not
// comparable (e.g. missing measurements), so neither side is highlighted.
type Edge = "a" | "b" | null

export default function TendencyComparisonPanel({
  playerA,
  playerB,
  seasonA,
  seasonB,
  statsA,
  statsB,
  onViewShotChart,
}: TendencyComparisonPanelProps) {
  const effA = scoringEfficiency(statsA)
  const effB = scoringEfficiency(statsB)
  const heightA = heightToInches(playerA.height)
  const heightB = heightToInches(playerB.height)

  return (
    <Card className="mt-6 rounded-2xl border bg-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
          <ArrowLeftRight className="h-3.5 w-3.5" />
          Matchup comparison
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Header row: each player's name, season, and shot-chart trigger. */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-3">
          <PlayerHeading
            align="left"
            name={playerA.name}
            season={seasonA}
            onViewShotChart={() => onViewShotChart(playerA, seasonA)}
          />
          <div className="flex flex-col items-center self-center">
            <span className="font-display text-2xl font-black italic leading-none text-muted-foreground/50">
              VS
            </span>
            <span className="mt-1 h-6 w-px bg-border" />
          </div>
          <PlayerHeading
            align="right"
            name={playerB.name}
            season={seasonB}
            onViewShotChart={() => onViewShotChart(playerB, seasonB)}
          />
        </div>

        {/* Key stats */}
        <Section title="Key stats">
          <CompareRow
            label="Points / game"
            a={statsA.points_per_game.toFixed(1)}
            b={statsB.points_per_game.toFixed(1)}
            edge={edgeOf(statsA.points_per_game, statsB.points_per_game, "high")}
          />
          <CompareRow
            label="Scoring efficiency (pts / FGA)"
            a={effA.toFixed(2)}
            b={effB.toFixed(2)}
            edge={edgeOf(effA, effB, "high")}
          />
          <CompareRow
            label="3PT shot rate"
            a={formatPct(statsA.three_point_attempt_rate)}
            b={formatPct(statsB.three_point_attempt_rate)}
            edge={edgeOf(
              statsA.three_point_attempt_rate,
              statsB.three_point_attempt_rate,
              "high"
            )}
          />
          <CompareRow
            label="Foul-drawing rate (FTA / FGA)"
            a={formatPct(statsA.free_throw_attempt_rate)}
            b={formatPct(statsB.free_throw_attempt_rate)}
            edge={edgeOf(
              statsA.free_throw_attempt_rate,
              statsB.free_throw_attempt_rate,
              "high"
            )}
          />
          <CompareRow
            label="Turnovers / game"
            a={statsA.turnover_per_game.toFixed(1)}
            b={statsB.turnover_per_game.toFixed(1)}
            // Fewer turnovers is the edge.
            edge={edgeOf(statsA.turnover_per_game, statsB.turnover_per_game, "low")}
          />
        </Section>

        {/* Physical attributes */}
        <Section title="Physical">
          <CompareRow
            label="Height"
            a={playerA.height ?? "N/A"}
            b={playerB.height ?? "N/A"}
            edge={edgeOf(heightA, heightB, "high")}
          />
          <CompareRow
            label="Weight"
            a={formatWeight(playerA.weight)}
            b={formatWeight(playerB.weight)}
            edge={edgeOf(weightToNumber(playerA.weight), weightToNumber(playerB.weight), "high")}
          />
          <CompareRow
            label="Wingspan"
            a={formatWingspan(playerA.wingspan)}
            b={formatWingspan(playerB.wingspan)}
            edge={edgeOf(playerA.wingspan, playerB.wingspan, "high")}
          />
        </Section>

        {/* Highlighted differentials */}
        <div>
          <div className="mb-3 flex items-center gap-1.5 font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
            <TrendingUp className="h-3.5 w-3.5" />
            Key differentials
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <DifferentialTile
              label="Height gap"
              value={
                heightA !== null && heightB !== null
                  ? `${Math.abs(heightA - heightB)}"`
                  : "N/A"
              }
              detail={heightEdgeLabel(playerA, playerB, heightA, heightB)}
              edge={
                heightA !== null && heightB !== null && heightA !== heightB
              }
            />
            <DifferentialTile
              label="Scoring efficiency"
              value={`${formatSigned(effA - effB)} pts/FGA`}
              detail={edgeLabel(playerA.name, playerB.name, effA - effB)}
              edge={Math.abs(effA - effB) >= 0.005}
            />
            <DifferentialTile
              label="Turnover rate"
              value={`${formatSigned(
                statsA.turnover_per_game - statsB.turnover_per_game
              )} /game`}
              detail={edgeLabel(
                // Fewer turnovers is the edge: a positive (B − A) delta means B
                // commits more, so player A holds the advantage.
                playerA.name,
                playerB.name,
                statsB.turnover_per_game - statsA.turnover_per_game
              )}
              edge={
                Math.abs(
                  statsB.turnover_per_game - statsA.turnover_per_game
                ) >= 0.005
              }
            />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function PlayerHeading({
  name,
  season,
  align,
  onViewShotChart,
}: {
  name: string
  season: string
  align: "left" | "right"
  onViewShotChart: () => void
}) {
  return (
    <div className={cn("space-y-1.5", align === "right" && "text-right")}>
      <div className="truncate font-display text-lg font-bold uppercase leading-none tracking-tight">
        {name}
      </div>
      <div className="font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground">
        {season} season
      </div>
      <Button
        variant="outline"
        size="sm"
        className="h-7 font-mono text-xs uppercase tracking-wider"
        onClick={onViewShotChart}
      >
        <ScatterChart className="h-3.5 w-3.5" />
        View Shot Chart
      </Button>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
        {title}
      </div>
      <div className="divide-y overflow-hidden rounded-xl border">
        {children}
      </div>
    </div>
  )
}

function CompareRow({
  label,
  a,
  b,
  edge,
}: {
  label: string
  a: string
  b: string
  edge: Edge
}) {
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-3 py-2.5 text-sm">
      <span
        className={cn(
          "text-left font-mono font-medium tabular-nums",
          edge === "a"
            ? "text-amber-600 dark:text-amber-400"
            : "text-foreground"
        )}
      >
        {a}
      </span>
      <span className="text-center font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          "text-right font-mono font-medium tabular-nums",
          edge === "b"
            ? "text-amber-600 dark:text-amber-400"
            : "text-foreground"
        )}
      >
        {b}
      </span>
    </div>
  )
}

function DifferentialTile({
  label,
  value,
  detail,
  edge,
}: {
  label: string
  value: string
  detail: string
  edge: boolean
}) {
  return (
    <div className="rounded-xl border bg-muted/30 px-3 py-2.5">
      <div className="font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "font-display text-2xl font-black uppercase leading-none tracking-tight tabular-nums",
          edge && "text-amber-600 dark:text-amber-400"
        )}
      >
        {value}
      </div>
      <div className="mt-1 truncate font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground">
        {detail}
      </div>
    </div>
  )
}

// Resolves which player holds the edge for a pair of measurements. `direction`
// declares whether a higher or lower value is the advantage. Returns null when
// either side is missing or the values are equal.
function edgeOf(
  a: number | null,
  b: number | null,
  direction: "high" | "low"
): Edge {
  if (a === null || b === null || a === b) return null
  const aWins = direction === "high" ? a > b : a < b
  return aWins ? "a" : "b"
}

function scoringEfficiency(stats: PlayerSeasonStats): number {
  if (!stats.fga_per_game) return 0
  return stats.points_per_game / stats.fga_per_game
}

function heightToInches(height: string | null): number | null {
  if (!height) return null
  const match = /(\d+)\s*-\s*(\d+)/.exec(height)
  if (!match) return null
  return Number(match[1]) * 12 + Number(match[2])
}

function weightToNumber(weight: string | null): number | null {
  if (!weight) return null
  const parsed = Number.parseFloat(weight)
  return Number.isNaN(parsed) ? null : parsed
}

function heightEdgeLabel(
  playerA: PlayerProfile,
  playerB: PlayerProfile,
  heightA: number | null,
  heightB: number | null
): string {
  if (heightA === null || heightB === null) return "—"
  if (heightA === heightB) return "Even"
  return heightA > heightB
    ? `${playerA.name} taller`
    : `${playerB.name} taller`
}

// Positive delta means `positiveName` holds the edge; negative means `negativeName`.
function edgeLabel(
  positiveName: string,
  negativeName: string,
  delta: number
): string {
  if (Math.abs(delta) < 0.005) return "Even"
  return delta > 0 ? `${positiveName} edge` : `${negativeName} edge`
}

function formatSigned(value: number): string {
  const rounded = Math.round(value * 100) / 100
  return rounded > 0 ? `+${rounded}` : `${rounded}`
}

function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function formatWeight(weight: string | null): string {
  return weight ? `${weight} lb` : "N/A"
}

function formatWingspan(wingspan: number | null): string {
  return typeof wingspan === "number" ? `${wingspan.toFixed(1)} in` : "N/A"
}
