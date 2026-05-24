import { Link } from "react-router-dom"
import { Activity, BarChart3, Swords } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

const FEATURES = [
  {
    icon: Swords,
    title: "ISO Simulator",
    description:
      "Run possession-by-possession 1v1 games between any two players, across any era.",
  },
  {
    icon: BarChart3,
    title: "Win probability",
    description:
      "Simulate a matchup a thousand times to see who really comes out on top.",
  },
  {
    icon: Activity,
    title: "Live scores",
    description: "Follow tonight's games and leaders around the league.",
  },
]

const Home = () => {
  return (
    <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-screen-xl flex-col items-center justify-center px-4 py-16 text-center">
      <Badge variant="secondary" className="mb-5">
        NBA matchup lab
      </Badge>
      <h2 className="mb-2 text-base font-medium text-muted-foreground">
        Welcome to
      </h2>
      <h1 className="text-5xl font-extrabold tracking-tight lg:text-6xl">
        Hoopvision
      </h1>
      <p className="mt-5 max-w-xl text-balance text-muted-foreground">
        Simulate any 1v1 matchup across eras, explore data-driven tendency
        profiles, and follow tonight's games — all powered by real NBA data.
      </p>

      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Button asChild size="lg">
          <Link to="/simulate">
            <Swords className="h-4 w-4" />
            Open the Simulator
          </Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link to="/live">
            <Activity className="h-4 w-4" />
            Live Scores
          </Link>
        </Button>
      </div>

      <div className="mt-16 grid w-full max-w-4xl grid-cols-1 gap-4 sm:grid-cols-3">
        {FEATURES.map((feature) => (
          <Card key={feature.title} className="rounded-lg text-left">
            <CardContent className="space-y-2 p-5">
              <div className="flex h-9 w-9 items-center justify-center rounded-md border bg-muted text-foreground">
                <feature.icon className="h-4 w-4" />
              </div>
              <div className="font-semibold">{feature.title}</div>
              <p className="text-sm text-muted-foreground">
                {feature.description}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

export default Home
