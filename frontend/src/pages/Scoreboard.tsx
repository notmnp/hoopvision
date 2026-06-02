import { AlertTriangle } from "lucide-react"
import { Link } from "react-router-dom"

import { Kicker, Rule, HalftoneAvatar } from "@/components/editorial"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import {
  type Game,
  type Leader,
  type Team,
  useScoreboard,
} from "@/hooks/useScoreboard"

/* ------------------------------------------------------------------ *
 * Status classification — derive a tidy band + label from the raw
 * gameStatusText the API hands us. We only key off text the hook
 * actually provides; we never invent fields.
 * ------------------------------------------------------------------ */

type Bucket = "live" | "final" | "upcoming"

interface Band {
  bucket: Bucket
  kicker: string
  blurb: (n: number) => string
}

const BANDS: Band[] = [
  {
    bucket: "live",
    kicker: "Live Now",
    blurb: (n) => `${n} ${n === 1 ? "game" : "games"} in progress`,
  },
  {
    bucket: "upcoming",
    kicker: "Tip-Off Soon",
    blurb: (n) => `${n} ${n === 1 ? "game" : "games"} on deck`,
  },
  {
    bucket: "final",
    kicker: "Final",
    blurb: (n) => `${n} ${n === 1 ? "game" : "games"} in the books`,
  },
]

function classify(status: string): Bucket {
  const s = status.trim().toLowerCase()
  if (!s) return "upcoming"
  if (s.includes("final")) return "final"
  // Scheduled games read like a tip-off time ("7:30 pm ET").
  if (/\b(am|pm)\b/.test(s) || /\bet\b/.test(s)) return "upcoming"
  if (s === "pregame" || s.startsWith("pre") || s.includes("tba")) {
    return "upcoming"
  }
  // Everything else — quarters, halftime, end of period — is live.
  return "live"
}

const DATELINE = new Date().toLocaleDateString("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
})

const Scoreboard = () => {
  const { games, loading, error } = useScoreboard()

  const grouped = BANDS.map((band) => ({
    band,
    games: games.filter((g) => classify(g.gameStatusText) === band.bucket),
  })).filter((group) => group.games.length > 0)

  const liveCount = games.filter(
    (g) => classify(g.gameStatusText) === "live"
  ).length

  return (
    <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-screen-xl flex-col px-4 py-8 md:px-6">
      <header className="mb-6 flex flex-col gap-4 pb-6 duration-700 animate-in fade-in slide-in-from-bottom-4 [animation-fill-mode:both] md:flex-row md:items-end md:justify-between">
        <div>
          <Kicker ruled>Live From Around the League</Kicker>
          <h1 className="mt-2 display text-5xl sm:text-6xl">Tonight's Slate</h1>
          <p className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-condensed text-[0.78rem] font-bold uppercase tracking-[0.14em] text-muted-foreground">
              <span>{DATELINE}</span>
              {!loading && !error && games.length > 0 && (
                <>
                  <span aria-hidden>·</span>
                  <span>
                    <span className="tabular-nums text-foreground">
                      {games.length}
                    </span>{" "}
                    {games.length === 1 ? "game" : "games"}
                  </span>
                  {liveCount > 0 && (
                    <>
                      <span aria-hidden>·</span>
                      <span className="inline-flex items-center gap-1.5 text-court">
                        <span className="relative flex h-2 w-2">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-court opacity-75" />
                          <span className="relative inline-flex h-2 w-2 rounded-full bg-court" />
                        </span>
                        <span className="tabular-nums">{liveCount}</span> live
                      </span>
                    </>
                  )}
                </>
              )}
            </p>
        </div>
      </header>
      <Rule weight="double" className="mb-6" />

      {loading && (
        <>
          <p className="mb-4 font-condensed text-[0.78rem] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            Pulling tonight's slate…
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <GameCardSkeleton key={index} />
            ))}
          </div>
        </>
      )}

      {!loading && error && (
        <Alert variant="destructive" className="max-w-2xl">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>The wire went quiet</AlertTitle>
          <AlertDescription>
            {error} The slate will refresh on your next visit.
          </AlertDescription>
        </Alert>
      )}

      {!loading && !error && games.length === 0 && (
        <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden rounded-sm border border-dashed py-20 text-center">
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 flex items-center justify-center font-display text-[16rem] font-black leading-none text-foreground/[0.04] sm:text-[22rem]"
          >
            0
          </span>
          <Kicker tone="muted">The League Is Dark</Kicker>
          <h2 className="mt-2 display text-3xl sm:text-4xl">No Games Tonight.</h2>
          <p className="mt-3 max-w-md text-pretty text-[0.95rem] leading-relaxed text-muted-foreground">
            The slate's empty. Check back tomorrow — or go settle the GOAT debate.
          </p>
          <Link
            to="/bracket"
            className="mt-5 inline-flex items-center gap-2 rounded-sm border border-primary bg-primary/10 px-4 py-2 font-condensed text-[0.78rem] font-bold uppercase tracking-[0.14em] text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
          >
            Build a Bracket →
          </Link>
        </div>
      )}

      {!loading && !error && games.length > 0 && (
        <div className="space-y-10">
          {grouped.map(({ band, games: bandGames }) => (
            <section
              key={band.bucket}
              className="animate-in fade-in slide-in-from-bottom-2 duration-500 [animation-fill-mode:both]"
            >
              <BandHeader band={band} count={bandGames.length} />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {bandGames.map((game) => (
                  <GameCard key={game.gameId} game={game} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

function BandHeader({ band, count }: { band: Band; count: number }) {
  const live = band.bucket === "live"
  return (
    <div className="mb-4 flex items-center gap-3">
      {live && (
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-court opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-court" />
        </span>
      )}
      <h2
        className={cn(
          "display text-2xl sm:text-3xl",
          live && "text-court"
        )}
      >
        {band.kicker}
      </h2>
      <span className="font-condensed text-[0.78rem] font-bold uppercase tracking-[0.14em] text-muted-foreground">
        {band.blurb(count)}
      </span>
      <Rule weight="thick" className="ml-1 flex-1" />
    </div>
  )
}

function GameCard({ game }: { game: Game }) {
  const bucket = classify(game.gameStatusText)
  const live = bucket === "live"
  const final = bucket === "final"
  const upcoming = bucket === "upcoming"

  const homeWinning = game.homeTeam.score > game.awayTeam.score
  const awayWinning = game.awayTeam.score > game.homeTeam.score

  const hasLeaders = Boolean(
    game.gameLeaders?.homeLeaders || game.gameLeaders?.awayLeaders
  )

  return (
    <Card
      className={cn(
        "group relative overflow-hidden rounded-sm border bg-card shadow-none transition-colors",
        live && "border-court/60"
      )}
    >
      {/* Live games get a vermillion->court spine on the left edge. */}
      {live && (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-1 bg-court"
        />
      )}
      <CardContent className="space-y-4 p-5">
        <div className="flex items-center justify-between gap-2">
          <Kicker tone="muted">{game.gameLabel}</Kicker>
          {live ? (
            <span className="inline-flex items-center gap-1.5 rounded-sm bg-court px-2 py-1 font-condensed text-[0.72rem] font-bold uppercase tracking-[0.12em] text-court-foreground">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
              {game.gameStatusText}
            </span>
          ) : final ? (
            <span className="inline-flex items-center rounded-sm border border-foreground/30 bg-foreground/[0.06] px-2 py-1 font-condensed text-[0.72rem] font-bold uppercase tracking-[0.12em] text-foreground">
              {game.gameStatusText}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-sm border bg-muted/50 px-2 py-1 font-condensed text-[0.72rem] font-bold uppercase tracking-[0.12em] text-muted-foreground">
              {game.gameStatusText}
            </span>
          )}
        </div>

        <div className="space-y-3">
          <TeamRow
            team={game.awayTeam}
            leading={awayWinning}
            final={final}
            upcoming={upcoming}
          />
          <TeamRow
            team={game.homeTeam}
            leading={homeWinning}
            final={final}
            upcoming={upcoming}
          />
        </div>

        {hasLeaders && (
          <>
            <Rule />
            <div className="space-y-2.5">
              <Kicker tone="muted">Top Scorers</Kicker>
              <div className="space-y-2">
                {game.gameLeaders?.awayLeaders && (
                  <LeaderRow
                    leader={game.gameLeaders.awayLeaders}
                    tricode={game.awayTeam.teamTricode}
                  />
                )}
                {game.gameLeaders?.homeLeaders && (
                  <LeaderRow
                    leader={game.gameLeaders.homeLeaders}
                    tricode={game.homeTeam.teamTricode}
                  />
                )}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function TeamRow({
  team,
  leading,
  final,
  upcoming,
}: {
  team: Team
  leading: boolean
  final: boolean
  upcoming: boolean
}) {
  // A final winner is the headline; everywhere else the live leader gets ink.
  const highlight = leading && !upcoming

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <HalftoneAvatar
          src={`https://cdn.nba.com/logos/nba/${team.teamId}/global/L/logo.svg`}
          alt={team.teamTricode}
          fallback={team.teamTricode}
          size={48}
          active={highlight}
        />
        <div>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "font-display text-xl font-bold uppercase leading-none tracking-tight",
                highlight && "text-primary"
              )}
            >
              {team.teamTricode}
            </span>
            {final && leading && (
              <span className="font-condensed text-[0.72rem] font-bold uppercase tracking-[0.12em] text-primary">
                Win
              </span>
            )}
          </div>
          <div className="mt-1 font-condensed text-[0.72rem] font-bold tabular-nums uppercase tracking-[0.12em] text-muted-foreground">
            {team.wins}-{team.losses}
          </div>
        </div>
      </div>
      {upcoming ? (
        // No score to honor yet — show a typographic placeholder, not "0".
        <span className="font-display text-2xl font-black leading-none text-muted-foreground/40">
          –
        </span>
      ) : (
        <span
          className={cn(
            "font-display text-[2.5rem] font-black tabular-nums leading-none",
            highlight ? "text-primary" : "text-foreground/55"
          )}
        >
          {team.score}
        </span>
      )}
    </div>
  )
}

function LeaderRow({ leader, tricode }: { leader: Leader; tricode: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <HalftoneAvatar
        src={`https://cdn.nba.com/headshots/nba/latest/1040x760/${leader.personId}.png`}
        alt={leader.name}
        fallback={getInitials(leader.name)}
        size={34}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate font-display text-[0.95rem] font-semibold leading-tight">
          {leader.name}
        </div>
        <div className="font-condensed text-[0.72rem] font-bold uppercase tracking-[0.12em] text-muted-foreground">
          {tricode}
        </div>
      </div>
      <span className="flex shrink-0 items-baseline gap-1">
        <span className="font-display text-xl font-black tabular-nums text-primary">
          {leader.points}
        </span>
        <span className="font-condensed text-[0.72rem] font-bold uppercase tracking-[0.12em] text-muted-foreground">
          pts
        </span>
      </span>
    </div>
  )
}

function GameCardSkeleton() {
  return (
    <Card className="rounded-sm border bg-card shadow-none">
      <CardContent className="space-y-4 p-5">
        <div className="flex items-center justify-between">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-5 w-16 rounded-sm" />
        </div>
        {Array.from({ length: 2 }).map((_, index) => (
          <div key={index} className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Skeleton className="h-12 w-12 rounded-sm" />
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-12" />
                <Skeleton className="h-3 w-10" />
              </div>
            </div>
            <Skeleton className="h-7 w-8" />
          </div>
        ))}
      </CardContent>
    </Card>
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

export default Scoreboard
