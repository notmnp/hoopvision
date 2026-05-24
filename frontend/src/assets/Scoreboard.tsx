import { Loader2 } from "lucide-react"

import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useScoreboard } from "@/hooks/useScoreboard"

const Scoreboard = () => {
  const { games, loading, error } = useScoreboard()

  return (
    <div className="min-h-screen px-4 py-8 max-w-screen-lg mx-auto">
      <h1 className="text-4xl font-extrabold tracking-tight mb-8">Scoreboard</h1>

      {loading && (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading games…
        </div>
      )}

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {!loading && !error && games.length === 0 && (
        <p className="text-muted-foreground text-sm">No games available.</p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {games.map((game) => (
          <Card key={game.gameId} className="p-5 space-y-4">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-3">
                <img
                  src={`https://cdn.nba.com/logos/nba/${game.awayTeam.teamId}/global/L/logo.svg`}
                  alt={game.awayTeam.teamTricode}
                  className="h-14 w-14"
                />
                <span className="text-base font-semibold">{game.awayTeam.teamTricode}</span>
              </div>
              <span className="text-lg font-bold">{game.awayTeam.score}</span>
            </div>

            <div className="flex justify-between items-center">
              <div className="flex items-center gap-3">
                <img
                  src={`https://cdn.nba.com/logos/nba/${game.homeTeam.teamId}/global/L/logo.svg`}
                  alt={game.homeTeam.teamTricode}
                  className="h-14 w-14"
                />
                <span className="text-base font-semibold">{game.homeTeam.teamTricode}</span>
              </div>
              <span className="text-lg font-bold">{game.homeTeam.score}</span>
            </div>

            <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">{game.gameLabel}</span>
                <Badge className="text-xs px-2 py-1">{game.gameStatusText}</Badge>
            </div>

            {(game.gameLeaders?.homeLeaders || game.gameLeaders?.awayLeaders) && (
              <div className="mt-2 space-y-2">
                {game.gameLeaders?.awayLeaders && (
                  <div className="flex items-center gap-3 text-sm">
                    <img
                      src={`https://cdn.nba.com/headshots/nba/latest/1040x760/${game.gameLeaders.awayLeaders.personId}.png`}
                      alt={game.gameLeaders.awayLeaders.name}
                      className="h-10 w-10 rounded-full object-cover"
                    />
                    <span className="text-sm font-medium">
                      {game.gameLeaders.awayLeaders.name} — {game.gameLeaders.awayLeaders.points} pts
                    </span>
                  </div>
                )}
                {game.gameLeaders?.homeLeaders && (
                  <div className="flex items-center gap-3 text-sm">
                    <img
                      src={`https://cdn.nba.com/headshots/nba/latest/1040x760/${game.gameLeaders.homeLeaders.personId}.png`}
                      alt={game.gameLeaders.homeLeaders.name}
                      className="h-10 w-10 rounded-full object-cover"
                    />
                    <span className="text-sm font-medium">
                      {game.gameLeaders.homeLeaders.name} — {game.gameLeaders.homeLeaders.points} pts
                    </span>
                  </div>
                )}
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  )
}

export default Scoreboard
