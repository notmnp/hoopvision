import { AlertTriangle, CalendarOff } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import {
  type Game,
  type Leader,
  type Team,
  useScoreboard,
} from "@/hooks/useScoreboard"

/** A game is live when its status text isn't a scheduled tip-off or a final. */
function isLiveStatus(status: string) {
  const s = status.trim().toLowerCase()
  if (!s) return false
  if (s.includes("final")) return false
  // Scheduled games read like a tip-off time ("7:30 pm ET").
  if (/\b(am|pm)\b/.test(s) || /\bet\b/.test(s)) return false
  if (s === "pregame" || s.startsWith("pre")) return false
  return true
}

const Scoreboard = () => {
  const { games, loading, error } = useScoreboard()

  return (
    <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-screen-xl flex-col px-4 py-8 md:px-6">
      <div className="relative mb-8 overflow-hidden border-b pb-6">
        {/* Court geometry + scout-card dot grid behind the header only */}
        <svg
          aria-hidden
          viewBox="0 0 1200 320"
          preserveAspectRatio="xMidYMin slice"
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[320px] w-full text-foreground/[0.05] dark:text-foreground/[0.07]"
          fill="none"
        >
          <circle cx="600" cy="-40" r="180" stroke="currentColor" strokeWidth="2" />
          <path
            d="M 120 -20 A 480 480 0 0 0 1080 -20"
            stroke="oklch(0.646 0.222 41 / 0.12)"
            strokeWidth="2"
          />
          <line x1="0" y1="1" x2="1200" y2="1" stroke="currentColor" strokeWidth="2" />
        </svg>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle,_oklch(0.6_0_0_/_0.12)_1px,_transparent_1px)] [background-size:26px_26px] [mask-image:linear-gradient(to_bottom,black,transparent_70%)]"
        />

        <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 [animation-fill-mode:both] flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="flex flex-col items-start">
            <span className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Live Scores
            </span>
            <h1 className="mt-2 font-display text-4xl font-black uppercase leading-none tracking-tight sm:text-5xl">
              Around the league
            </h1>
            <p className="mt-3 max-w-md text-pretty text-sm leading-relaxed text-muted-foreground">
              Tonight's games, scores, and game leaders from across the NBA.
            </p>
          </div>
          {!loading && !error && games.length > 0 && (
            <span className="inline-flex w-fit items-center gap-2 rounded-full border bg-muted/40 px-3 py-1 font-mono text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground">
              <span className="tabular-nums text-foreground">{games.length}</span>
              {games.length === 1 ? "game" : "games"} today
            </span>
          )}
        </div>
      </div>

      {loading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <GameCardSkeleton key={index} />
          ))}
        </div>
      )}

      {!loading && error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Couldn't load games</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!loading && !error && games.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed py-16 text-center">
          <CalendarOff className="h-8 w-8 text-muted-foreground/50" />
          <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            No games available right now.
          </p>
        </div>
      )}

      {!loading && !error && games.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {games.map((game) => (
            <GameCard key={game.gameId} game={game} />
          ))}
        </div>
      )}
    </div>
  )
}

function GameCard({ game }: { game: Game }) {
  const homeWinning = game.homeTeam.score > game.awayTeam.score
  const awayWinning = game.awayTeam.score > game.homeTeam.score
  const live = isLiveStatus(game.gameStatusText)

  return (
    <Card className="overflow-hidden rounded-2xl border bg-card">
      <CardContent className="space-y-4 p-5">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground">
            {game.gameLabel}
          </span>
          {live ? (
            <span className="inline-flex items-center gap-1.5 rounded bg-red-600 px-2 py-0.5 font-mono text-[0.6rem] font-medium uppercase tracking-wider text-white">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
              {game.gameStatusText}
            </span>
          ) : (
            <span className="inline-flex items-center rounded border bg-muted/50 px-2 py-0.5 font-mono text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">
              {game.gameStatusText}
            </span>
          )}
        </div>

        <div className="space-y-3">
          <TeamRow team={game.awayTeam} leading={awayWinning} />
          <TeamRow team={game.homeTeam} leading={homeWinning} />
        </div>

        {(game.gameLeaders?.homeLeaders || game.gameLeaders?.awayLeaders) && (
          <>
            <Separator />
            <div className="space-y-2">
              {game.gameLeaders?.awayLeaders && (
                <LeaderRow leader={game.gameLeaders.awayLeaders} />
              )}
              {game.gameLeaders?.homeLeaders && (
                <LeaderRow leader={game.gameLeaders.homeLeaders} />
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function TeamRow({ team, leading }: { team: Team; leading: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <Avatar className="h-12 w-12 rounded-none bg-transparent">
          <AvatarImage
            src={`https://cdn.nba.com/logos/nba/${team.teamId}/global/L/logo.svg`}
            alt={team.teamTricode}
            className="object-contain"
          />
          <AvatarFallback className="rounded-lg text-xs font-medium">
            {team.teamTricode}
          </AvatarFallback>
        </Avatar>
        <div>
          <div
            className={cn(
              "font-display text-xl font-bold uppercase leading-none tracking-tight",
              leading && "text-amber-600 dark:text-amber-400"
            )}
          >
            {team.teamTricode}
          </div>
          <div className="mt-1 font-mono text-xs tabular-nums uppercase tracking-wider text-muted-foreground">
            {team.wins}-{team.losses}
          </div>
        </div>
      </div>
      <span
        className={cn(
          "font-display text-3xl font-black tabular-nums leading-none",
          leading ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"
        )}
      >
        {team.score}
      </span>
    </div>
  )
}

function LeaderRow({ leader }: { leader: Leader }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <Avatar className="h-9 w-9 rounded-lg">
        <AvatarImage
          src={`https://cdn.nba.com/headshots/nba/latest/1040x760/${leader.personId}.png`}
          alt={leader.name}
          className="object-cover object-top"
        />
        <AvatarFallback className="rounded-lg text-xs font-medium">
          {getInitials(leader.name)}
        </AvatarFallback>
      </Avatar>
      <span className="truncate font-medium">{leader.name}</span>
      <span className="ml-auto shrink-0 font-mono text-xs uppercase tracking-wider text-muted-foreground">
        <span className="tabular-nums text-foreground">{leader.points}</span> pts
      </span>
    </div>
  )
}

function GameCardSkeleton() {
  return (
    <Card className="rounded-2xl border bg-card">
      <CardContent className="space-y-4 p-5">
        <div className="flex items-center justify-between">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-5 w-16 rounded" />
        </div>
        {Array.from({ length: 2 }).map((_, index) => (
          <div key={index} className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Skeleton className="h-12 w-12 rounded-lg" />
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
