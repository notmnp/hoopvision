import { AlertTriangle, CalendarOff } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import {
  type Game,
  type Leader,
  type Team,
  useScoreboard,
} from "@/hooks/useScoreboard"

const Scoreboard = () => {
  const { games, loading, error } = useScoreboard()

  return (
    <div className="mx-auto min-h-screen max-w-screen-lg px-4 py-8">
      <div className="mb-8 space-y-1">
        <h1 className="text-4xl font-extrabold tracking-tight">Scoreboard</h1>
        <p className="text-sm text-muted-foreground">
          Today's games around the league.
        </p>
      </div>

      {loading && (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
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
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-16 text-center">
          <CalendarOff className="h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            No games available right now.
          </p>
        </div>
      )}

      {!loading && !error && games.length > 0 && (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
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

  return (
    <Card className="overflow-hidden rounded-lg">
      <CardContent className="space-y-4 p-5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">
            {game.gameLabel}
          </span>
          <Badge variant="secondary" className="text-xs">
            {game.gameStatusText}
          </Badge>
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
          <AvatarFallback className="rounded-md text-xs font-semibold">
            {team.teamTricode}
          </AvatarFallback>
        </Avatar>
        <div>
          <div className="text-base font-semibold">{team.teamTricode}</div>
          <div className="text-xs tabular-nums text-muted-foreground">
            {team.wins}-{team.losses}
          </div>
        </div>
      </div>
      <span
        className={
          leading
            ? "text-2xl font-bold tabular-nums"
            : "text-2xl font-semibold tabular-nums text-muted-foreground"
        }
      >
        {team.score}
      </span>
    </div>
  )
}

function LeaderRow({ leader }: { leader: Leader }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <Avatar className="h-9 w-9">
        <AvatarImage
          src={`https://cdn.nba.com/headshots/nba/latest/1040x760/${leader.personId}.png`}
          alt={leader.name}
          className="object-cover object-top"
        />
        <AvatarFallback className="text-xs font-medium">
          {getInitials(leader.name)}
        </AvatarFallback>
      </Avatar>
      <span className="font-medium">{leader.name}</span>
      <span className="ml-auto tabular-nums text-muted-foreground">
        {leader.points} pts
      </span>
    </div>
  )
}

function GameCardSkeleton() {
  return (
    <Card className="rounded-lg">
      <CardContent className="space-y-4 p-5">
        <div className="flex items-center justify-between">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
        {Array.from({ length: 2 }).map((_, index) => (
          <div key={index} className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Skeleton className="h-12 w-12 rounded-md" />
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
