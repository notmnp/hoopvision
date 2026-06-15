import { useEffect, useState } from "react"
import { AlertTriangle, Loader2 } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { ShotZone, useShotChart } from "@/hooks/useShotChart"
import { COURT_VIEWBOX, CourtLines, ZONE_POSITIONS } from "@/lib/court"

export interface ShotChartTarget {
  playerId: number
  playerName: string
  seasonId: string
}

// ShotChartSheet (Tendency Explorer). A centered modal that renders a
// season-scoped shot chart: a half-court diagram whose zone markers encode
// attempt frequency (marker size) and efficiency (color gradient). It fetches
// lazily via useShotChart on open (ADR-002) — never at panel mount — and
// renders a data warning rather than an empty/broken chart for pre-tracking-era
// seasons.
export default function ShotChartSheet({
  target,
  onOpenChange,
}: {
  target: ShotChartTarget | null
  onOpenChange: (open: boolean) => void
}) {
  const { data, loading, error, fetch, reset } = useShotChart(
    target?.playerId ?? null,
    target?.seasonId ?? null
  )

  // Lazy fetch: fire only when the sheet opens for a target; clear on close.
  useEffect(() => {
    if (target) {
      fetch()
    } else {
      reset()
    }
  }, [target, fetch, reset])

  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="display text-2xl">
            {target ? target.playerName : "Shot chart"}
          </DialogTitle>
          <DialogDescription className="kicker">
            {target ? `Shot Report — ${target.seasonId}` : "Shot Report"}
          </DialogDescription>
        </DialogHeader>

        <div>
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 font-condensed text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Developing the shot report…
            </div>
          ) : error ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Couldn't load shot chart</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : data && !data.available ? (
            <DataWarning warnings={data.data_warnings} />
          ) : data ? (
            <ShotChartCourt zones={data.zones} />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function DataWarning({ warnings }: { warnings: string[] }) {
  const messages = warnings.length
    ? warnings
    : ["Shot location data is unavailable for this season."]
  return (
    <Alert className="border-primary/40 bg-primary/10 text-primary [&>svg]:text-primary">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>Shot data unavailable</AlertTitle>
      <AlertDescription className="text-primary/90">
        <ul className="list-disc space-y-1 pl-4">
          {messages.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  )
}

function zoneKey(zone: ShotZone): string {
  return `${zone.zone_label}|${zone.zone_area}`
}

function ShotChartCourt({ zones }: { zones: ShotZone[] }) {
  const [activeKey, setActiveKey] = useState<string | null>(null)

  const positioned = zones.filter((zone) => ZONE_POSITIONS[zoneKey(zone)])
  const maxAttempts = positioned.reduce(
    (max, zone) => Math.max(max, zone.attempts),
    0
  )
  const active =
    positioned.find((zone) => zoneKey(zone) === activeKey) ?? null
  const totalAttempts = zones.reduce((sum, zone) => sum + zone.attempts, 0)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between font-condensed text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
        <span>Bigger dot = more shots · warmer = better clip</span>
        <span className="tabular-nums">{totalAttempts} FGA</span>
      </div>

      <div className="overflow-hidden rounded-sm border bg-muted/20">
        <svg viewBox={COURT_VIEWBOX} className="h-auto w-full">
          <CourtLines />
          {positioned.map((zone) => {
            const key = zoneKey(zone)
            const { x, y } = ZONE_POSITIONS[key]
            const radius =
              maxAttempts > 0 ? 10 + 24 * (zone.attempts / maxAttempts) : 10
            const color = efficiencyColor(zone.fg_pct)
            return (
              <g
                key={key}
                tabIndex={0}
                role="button"
                aria-label={`${zone.zone_label}, ${zone.zone_area}: ${zone.attempts} attempts, ${formatPct(zone.fg_pct)} FG%`}
                className="cursor-pointer outline-none"
                onMouseEnter={() => setActiveKey(key)}
                onMouseLeave={() => setActiveKey(null)}
                onFocus={() => setActiveKey(key)}
                onBlur={() => setActiveKey(null)}
                onClick={() => setActiveKey(key)}
              >
                <title>
                  {`${zone.zone_label} — ${zone.attempts} att, ${formatPct(
                    zone.fg_pct
                  )}`}
                </title>
                <circle
                  cx={x}
                  cy={y}
                  r={radius}
                  fill={color}
                  fillOpacity={activeKey === key ? 0.95 : 0.7}
                  stroke={color}
                  strokeWidth={activeKey === key ? 3 : 1}
                />
              </g>
            )
          })}
        </svg>
      </div>

      <ZoneDetail zone={active} />
    </div>
  )
}

function ZoneDetail({ zone }: { zone: ShotZone | null }) {
  if (!zone) {
    return (
      <div className="rounded-sm border bg-background/60 px-3 py-2 font-condensed text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
        Hover or tap a zone to see attempts and field-goal percentage.
      </div>
    )
  }
  return (
    <div className="flex items-center justify-between rounded-sm border bg-background/60 px-3 py-2 text-sm">
      <div>
        <div className="display text-lg leading-none">
          {zone.zone_label}
        </div>
        <div className="mt-1 kicker text-muted-foreground">
          {zone.zone_area}
        </div>
      </div>
      <div className="flex items-center gap-4">
        <div className="text-right">
          <div className="kicker text-muted-foreground">
            Made / Att
          </div>
          <div className="font-display text-base font-bold tabular-nums">
            {zone.made} / {zone.attempts}
          </div>
        </div>
        <div className="text-right">
          <div className="kicker text-muted-foreground">
            FG%
          </div>
          <div className="font-display text-base font-bold tabular-nums">
            {formatPct(zone.fg_pct)}
          </div>
        </div>
      </div>
    </div>
  )
}

// Map FG% to a cool→hot gradient across a realistic 20%–60% band: cold shooting
// reads as muted ink, a hot clip reads as editorial vermillion.
function efficiencyColor(fgPct: number): string {
  const t = clamp((fgPct - 0.2) / (0.6 - 0.2), 0, 1)
  const cold = [120, 113, 108] // muted ink
  const vermillion = [225, 74, 47] // editorial primary
  const rgb = mix(cold, vermillion, t)
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`
}

function mix(a: number[], b: number[], t: number): number[] {
  return a.map((value, index) => Math.round(value + (b[index] - value) * t))
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}
