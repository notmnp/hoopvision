import { useEffect, useState } from "react"
import { AlertTriangle, Loader2 } from "lucide-react"

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { ShotZone, useShotChart } from "@/hooks/useShotChart"

export interface ShotChartTarget {
  playerId: number
  playerName: string
  seasonId: string
}

// ShotChartSheet (Tendency Explorer). A side sheet that renders a season-scoped
// shot chart: a half-court diagram whose zone markers encode attempt frequency
// (marker size) and efficiency (color gradient). It fetches lazily via
// useShotChart on open (ADR-002) — never at panel mount — and renders a data
// warning rather than an empty/broken chart for pre-tracking-era seasons.
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
    <Sheet open={target !== null} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{target ? target.playerName : "Shot chart"}</SheetTitle>
          <SheetDescription>
            {target ? `${target.seasonId} season shot chart` : "Shot chart"}
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 pb-6">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading shot chart…
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
      </SheetContent>
    </Sheet>
  )
}

function DataWarning({ warnings }: { warnings: string[] }) {
  const messages = warnings.length
    ? warnings
    : ["Shot location data is unavailable for this season."]
  return (
    <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 [&>svg]:text-amber-600 dark:[&>svg]:text-amber-400">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>Shot data unavailable</AlertTitle>
      <AlertDescription className="text-amber-700/90 dark:text-amber-300/90">
        <ul className="list-disc space-y-1 pl-4">
          {messages.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  )
}

// Approximate court position (in the 0..500 x, 0..470 y viewBox) for each NBA
// shot zone, keyed by `${SHOT_ZONE_BASIC}|${SHOT_ZONE_AREA}`. The hoop sits near
// the bottom baseline; zones radiate outward toward the 3-point line.
const ZONE_POSITIONS: Record<string, { x: number; y: number }> = {
  "Restricted Area|Center(C)": { x: 250, y: 388 },
  "In The Paint (Non-RA)|Center(C)": { x: 250, y: 318 },
  "In The Paint (Non-RA)|Left Side(L)": { x: 205, y: 330 },
  "In The Paint (Non-RA)|Right Side(R)": { x: 295, y: 330 },
  "Mid-Range|Center(C)": { x: 250, y: 250 },
  "Mid-Range|Left Side(L)": { x: 110, y: 320 },
  "Mid-Range|Left Side Center(LC)": { x: 170, y: 250 },
  "Mid-Range|Right Side Center(RC)": { x: 330, y: 250 },
  "Mid-Range|Right Side(R)": { x: 390, y: 320 },
  "Left Corner 3|Left Side(L)": { x: 42, y: 392 },
  "Right Corner 3|Right Side(R)": { x: 458, y: 392 },
  "Above the Break 3|Left Side Center(LC)": { x: 110, y: 150 },
  "Above the Break 3|Center(C)": { x: 250, y: 110 },
  "Above the Break 3|Right Side Center(RC)": { x: 390, y: 150 },
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
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Marker size = attempts · color = FG%</span>
        <span className="tabular-nums">{totalAttempts} FGA</span>
      </div>

      <div className="overflow-hidden rounded-md border bg-muted/20">
        <svg viewBox="0 0 500 470" className="h-auto w-full">
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
      <div className="rounded-md border bg-background/60 px-3 py-2 text-xs text-muted-foreground">
        Hover or tap a zone to see attempts and field-goal percentage.
      </div>
    )
  }
  return (
    <div className="flex items-center justify-between rounded-md border bg-background/60 px-3 py-2 text-sm">
      <div>
        <div className="font-medium">{zone.zone_label}</div>
        <div className="text-xs text-muted-foreground">{zone.zone_area}</div>
      </div>
      <div className="flex items-center gap-4 tabular-nums">
        <div className="text-right">
          <div className="text-xs text-muted-foreground">Made / Att</div>
          <div className="font-semibold">
            {zone.made} / {zone.attempts}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">FG%</div>
          <div className="font-semibold">{formatPct(zone.fg_pct)}</div>
        </div>
      </div>
    </div>
  )
}

// Stylized half-court: outer bound, the paint/key, free-throw circle, the
// 3-point line (corners + arc), and the hoop.
function CourtLines() {
  return (
    <g
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      className="text-foreground/25"
    >
      <rect x={2} y={2} width={496} height={466} rx={4} />
      <rect x={170} y={280} width={160} height={188} />
      <circle cx={250} cy={280} r={60} />
      <path d="M 30 468 L 30 330 A 237.5 237.5 0 0 1 470 330 L 470 468" />
      <circle
        cx={250}
        cy={418}
        r={9}
        className="text-foreground/50"
        strokeWidth={2.5}
      />
      <line x1={220} y1={430} x2={280} y2={430} className="text-foreground/50" />
    </g>
  )
}

// Map FG% to a red→amber→green gradient across a realistic 20%–60% band.
function efficiencyColor(fgPct: number): string {
  const t = clamp((fgPct - 0.2) / (0.6 - 0.2), 0, 1)
  const red = [239, 68, 68]
  const amber = [234, 179, 8]
  const green = [16, 185, 129]
  const rgb =
    t < 0.5 ? mix(red, amber, t / 0.5) : mix(amber, green, (t - 0.5) / 0.5)
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
