import { ReactNode } from "react"
import { ScatterChart } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Kicker, Rule } from "@/components/editorial"
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
  const tsA = statsA.true_shooting_pct
  const tsB = statsB.true_shooting_pct
  const astToA = assistTurnoverRatio(statsA)
  const astToB = assistTurnoverRatio(statsB)
  const stocksA = defensiveStocks(statsA)
  const stocksB = defensiveStocks(statsB)

  return (
    <Card className="mt-6 rounded-sm border bg-card">
      <CardHeader className="space-y-2">
        <Kicker ruled>Head to Head</Kicker>
        <CardTitle className="font-display text-3xl font-black uppercase tracking-tight sm:text-4xl">
          By the Numbers
        </CardTitle>
        <p className="font-display text-sm italic leading-relaxed text-muted-foreground">
          Where the matchup is won and lost.
        </p>
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
          <div className="flex flex-col items-center self-stretch">
            <span className="font-display text-2xl font-black italic leading-none text-muted-foreground/50">
              vs.
            </span>
            <Rule vertical className="mt-1 flex-1" />
          </div>
          <PlayerHeading
            align="right"
            name={playerB.name}
            season={seasonB}
            onViewShotChart={() => onViewShotChart(playerB, seasonB)}
          />
        </div>

        {/* Scoring & shooting — efficiency/rate metrics the player cards (which
            show raw per-game volume) don't surface. */}
        <Section title="The Scoring Case">
          <CompareRow
            label="True shooting %"
            a={formatPct(tsA)}
            b={formatPct(tsB)}
            edge={edgeOf(tsA, tsB, "high")}
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
            label="Free-throw %"
            a={formatPct(statsA.free_throw_pct)}
            b={formatPct(statsB.free_throw_pct)}
            edge={edgeOf(statsA.free_throw_pct, statsB.free_throw_pct, "high")}
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
        </Section>

        {/* Playmaking & defense — replaces the Physical section, whose
            height/weight/wingspan already appear on each player card. */}
        <Section title="Facilitating & Defense">
          <CompareRow
            label="Assist-to-turnover ratio"
            a={astToA.toFixed(1)}
            b={astToB.toFixed(1)}
            edge={edgeOf(astToA, astToB, "high")}
          />
          <CompareRow
            label="Turnovers / game"
            a={statsA.turnover_per_game.toFixed(1)}
            b={statsB.turnover_per_game.toFixed(1)}
            // Fewer turnovers is the edge.
            edge={edgeOf(statsA.turnover_per_game, statsB.turnover_per_game, "low")}
          />
          <CompareRow
            label="Defensive disruption (STL + BLK)"
            a={stocksA.toFixed(1)}
            b={stocksB.toFixed(1)}
            edge={edgeOf(stocksA, stocksB, "high")}
          />
          <CompareRow
            label="Fouls / game"
            a={statsA.personal_foul_per_game.toFixed(1)}
            b={statsB.personal_foul_per_game.toFixed(1)}
            // Fewer fouls is the edge.
            edge={edgeOf(
              statsA.personal_foul_per_game,
              statsB.personal_foul_per_game,
              "low"
            )}
          />
        </Section>

        {/* Highlighted differentials */}
        <div>
          <div className="mb-3">
            <Kicker>The Deciding Margins</Kicker>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <DifferentialTile
              label="True shooting %"
              value={`${formatSigned((tsA - tsB) * 100)}%`}
              detail={edgeLabel(playerA.name, playerB.name, tsA - tsB)}
              edge={Math.abs(tsA - tsB) >= 0.005}
            />
            <DifferentialTile
              label="Assist-to-TO ratio"
              value={formatSigned(astToA - astToB)}
              detail={edgeLabel(playerA.name, playerB.name, astToA - astToB)}
              edge={Math.abs(astToA - astToB) >= 0.05}
            />
            <DifferentialTile
              label="Defensive disruption"
              value={`${formatSigned(stocksA - stocksB)} /game`}
              detail={edgeLabel(playerA.name, playerB.name, stocksA - stocksB)}
              edge={Math.abs(stocksA - stocksB) >= 0.05}
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
    <div
      className={cn(
        "flex flex-col gap-2.5",
        align === "right" ? "items-end text-right" : "items-start text-left"
      )}
    >
      <div>
        <div className="truncate display text-xl leading-none">{name}</div>
        <div className="mt-1.5 kicker text-muted-foreground">
          {season} season
        </div>
      </div>
      {/* Pulled toward the center divider — flanking the "vs." rather than
          hanging off the outer edges. */}
      <div
        className={cn(
          "flex w-full",
          align === "left" ? "justify-end" : "justify-start"
        )}
      >
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 border-foreground/30 bg-background/60 font-condensed text-[0.7rem] font-bold uppercase tracking-[0.14em] hover:bg-foreground hover:text-background"
          onClick={onViewShotChart}
        >
          <ScatterChart className="h-3.5 w-3.5 text-primary" />
          Shot Chart
        </Button>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-2">
        <Kicker tone="muted">{title}</Kicker>
      </div>
      <div className="divide-y overflow-hidden rounded-sm border">
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
          "flex items-center justify-start gap-1.5 text-left font-display font-bold tabular-nums",
          edge === "a" ? "text-primary" : "text-foreground"
        )}
      >
        {edge === "a" && <span aria-hidden>▸</span>}
        {a}
      </span>
      <span className="text-center kicker text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          "flex items-center justify-end gap-1.5 text-right font-display font-bold tabular-nums",
          edge === "b" ? "text-primary" : "text-foreground"
        )}
      >
        {b}
        {edge === "b" && <span aria-hidden>◂</span>}
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
    <div className="rounded-sm border bg-muted/30 px-3 py-2.5">
      <div className="kicker text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "mt-1 font-display text-3xl font-black leading-none tabular-nums",
          edge ? "text-primary" : "text-foreground"
        )}
      >
        {value}
      </div>
      <div className="mt-1 truncate kicker text-muted-foreground">
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

// Playmaking efficiency: assists earned per turnover committed.
function assistTurnoverRatio(stats: PlayerSeasonStats): number {
  return stats.turnover_per_game > 0
    ? stats.assist_per_game / stats.turnover_per_game
    : stats.assist_per_game
}

// "Stocks": combined defensive disruption (steals + blocks per game).
function defensiveStocks(stats: PlayerSeasonStats): number {
  return stats.steal_per_game + stats.block_per_game
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
