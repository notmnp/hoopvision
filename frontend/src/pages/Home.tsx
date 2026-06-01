import { useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { Activity, Swords, Trophy } from "lucide-react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const HEADSHOT = (id: number) =>
  `https://cdn.nba.com/headshots/nba/latest/1040x760/${id}.png`

/** A frozen simulation result, used as the hero showcase. */
const MATCHUP = {
  label: "Sim result · 1,000 runs",
  a: {
    id: 893,
    name: "Michael Jordan",
    initials: "MJ",
    team: "CHI",
    era: "1995-96",
    win: 63,
    won: 630,
    stats: [
      { l: "PTS", v: "30.4", pct: 95 },
      { l: "AST", v: "4.3", pct: 43 },
      { l: "REB", v: "6.6", pct: 55 },
    ],
  },
  b: {
    id: 2544,
    name: "LeBron James",
    initials: "LJ",
    team: "MIA",
    era: "2012-13",
    win: 37,
    won: 370,
    stats: [
      { l: "PTS", v: "26.8", pct: 84 },
      { l: "AST", v: "7.3", pct: 73 },
      { l: "REB", v: "8.0", pct: 67 },
    ],
  },
}

const TICKER = [
  "Jordan vs. LeBron",
  "Kobe vs. Durant",
  "Magic vs. Bird",
  "Shaq vs. Hakeem",
  "Curry vs. Pistol Pete",
  "Wilt vs. Kareem",
  "Duncan vs. Garnett",
  "Iverson vs. Stockton",
]

const STATS = [
  { target: 1000, label: "sims per matchup" },
  { target: 32, label: "legends per bracket" },
  { target: 21, label: "points to win" },
]

const MODES = [
  {
    to: "/simulate",
    tag: "Mode 01",
    icon: Swords,
    figure: "01",
    title: "ISO Simulator",
    copy: "Pick any two players, any era. A thousand possessions decide who actually wins.",
    cta: "Run the matchup",
  },
  {
    to: "/bracket",
    tag: "Mode 02",
    icon: Trophy,
    figure: "02",
    title: "GOAT Bracket",
    copy: "Seed 8, 16, or 32 legends and simulate every round down to a single champion.",
    cta: "Build the bracket",
  },
  {
    to: "/live",
    tag: "Live",
    icon: Activity,
    figure: "03",
    title: "Live Scores",
    copy: "Tonight's games, scores, and standout leaders from around the league, as they happen.",
    cta: "See tonight's board",
    live: true,
  },
]

/** Counts up to `target` once the element scrolls into view. */
function useCountUp(target: number, duration = 1400) {
  const ref = useRef<HTMLSpanElement>(null)
  const [value, setValue] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setValue(target)
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        observer.disconnect()
        const start = performance.now()
        const tick = (now: number) => {
          const p = Math.min((now - start) / duration, 1)
          const eased = 1 - Math.pow(1 - p, 3)
          setValue(Math.round(eased * target))
          if (p < 1) requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      },
      { threshold: 0.6 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [target, duration])

  return { ref, value }
}

function reveal(delay: number) {
  return {
    className:
      "animate-in fade-in slide-in-from-bottom-4 duration-700 [animation-fill-mode:both]",
    style: { animationDelay: `${delay}ms` },
  }
}

function StatRow({
  stat,
  align,
}: {
  stat: { l: string; v: string; pct: number }
  align: "left" | "right"
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2",
        align === "right" && "flex-row-reverse"
      )}
    >
      <span className="w-7 shrink-0 font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground">
        {stat.l}
      </span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-foreground/10">
        <div
          className={cn(
            "h-full rounded-full bg-foreground/35",
            align === "right" && "ml-auto"
          )}
          style={{ width: `${stat.pct}%` }}
        />
      </div>
      <span className="w-9 shrink-0 text-center font-mono text-xs font-medium tabular-nums">
        {stat.v}
      </span>
    </div>
  )
}

function PlayerColumn({
  player,
  winner,
  align,
}: {
  player: typeof MATCHUP.a
  winner: boolean
  align: "left" | "right"
}) {
  return (
    <div className="flex flex-col gap-3">
      <div
        className={cn(
          "flex items-center gap-3",
          align === "right" && "flex-row-reverse text-right"
        )}
      >
        <Avatar
          className={cn(
            "size-12 rounded-lg ring-2",
            winner ? "ring-amber-500" : "ring-border"
          )}
        >
          <AvatarImage
            src={HEADSHOT(player.id)}
            className="object-cover object-top"
          />
          <AvatarFallback className="rounded-lg text-xs font-medium">
            {player.initials}
          </AvatarFallback>
        </Avatar>
        <div className={cn("min-w-0", align === "right" && "items-end")}>
          <div
            className={cn(
              "truncate font-display text-lg font-bold uppercase leading-none tracking-tight",
              winner && "text-amber-600 dark:text-amber-400"
            )}
          >
            {player.name}
          </div>
          <div className="mt-1 font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground">
            {player.team} · {player.era}
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        {player.stats.map((s) => (
          <StatRow key={s.l} stat={s} align={align} />
        ))}
      </div>
    </div>
  )
}

const Home = () => {
  return (
    <div className="relative overflow-hidden">
      {/* Court geometry — center circle + three-point arc instead of glow blobs */}
      <svg
        aria-hidden
        viewBox="0 0 1200 600"
        preserveAspectRatio="xMidYMin slice"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[560px] w-full text-foreground/[0.05] dark:text-foreground/[0.07]"
        fill="none"
      >
        <circle cx="600" cy="-40" r="210" stroke="currentColor" strokeWidth="2" />
        <path
          d="M 120 -20 A 480 480 0 0 0 1080 -20"
          stroke="oklch(0.646 0.222 41 / 0.12)"
          strokeWidth="2"
        />
        <line x1="0" y1="1" x2="1200" y2="1" stroke="currentColor" strokeWidth="2" />
      </svg>
      {/* Faint scout-card dot grid */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle,_oklch(0.6_0_0_/_0.12)_1px,_transparent_1px)] [background-size:26px_26px] [mask-image:linear-gradient(to_bottom,black,transparent_70%)]"
      />

      <div className="mx-auto w-full max-w-screen-xl px-4 py-16 lg:py-24">
        {/* Hero — asymmetric: copy left, live result right */}
        <section className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-8">
          <div className="flex flex-col items-start text-left">
            <span
              {...reveal(0)}
              className={cn(
                reveal(0).className,
                "inline-flex items-center gap-2 rounded-full border bg-muted/40 px-3 py-1 font-mono text-[0.65rem] font-medium uppercase tracking-[0.18em] text-muted-foreground"
              )}
            >
              The NBA matchup engine
            </span>

            <h1
              {...reveal(120)}
              className={cn(
                reveal(120).className,
                "mt-6 font-display text-6xl font-black uppercase leading-[0.85] tracking-tight sm:text-7xl lg:text-8xl"
              )}
            >
              Stop arguing.
              <br />
              Run the <span className="text-amber-500">sim</span>.
            </h1>

            <p
              {...reveal(240)}
              className={cn(
                reveal(240).className,
                "mt-6 max-w-md text-pretty text-base leading-relaxed text-muted-foreground"
              )}
            >
              Drop any two players on the court, across any era, and let a
              thousand possessions decide who really wins. Real NBA tendencies,
              no guesswork.
            </p>

            <div
              {...reveal(360)}
              className={cn(reveal(360).className, "mt-8 flex flex-wrap gap-3")}
            >
              <Button asChild size="lg">
                <Link to="/simulate">
                  <Swords className="h-4 w-4" />
                  Run a matchup
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to="/bracket">
                  <Trophy className="h-4 w-4" />
                  Build a GOAT bracket
                </Link>
              </Button>
            </div>
          </div>

          {/* Live VS result card */}
          <div
            {...reveal(300)}
            className={cn(
              reveal(300).className,
              "relative w-full rounded-2xl border bg-card shadow-xl shadow-black/5"
            )}
          >
            <div className="flex items-center justify-between border-b px-5 py-3">
              <span className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground">
                {MATCHUP.label}
              </span>
              <span className="inline-flex items-center gap-1.5 font-mono text-[0.65rem] uppercase tracking-wider text-amber-600 dark:text-amber-400">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                Final
              </span>
            </div>

            <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-3 px-5 py-6">
              <PlayerColumn player={MATCHUP.a} winner align="left" />
              <div className="flex flex-col items-center justify-center self-center">
                <span className="font-display text-4xl font-black italic leading-none text-muted-foreground/50">
                  VS
                </span>
                <span className="mt-1 h-8 w-px bg-border" />
              </div>
              <PlayerColumn player={MATCHUP.b} winner={false} align="right" />
            </div>

            <div className="space-y-2 border-t px-5 py-4">
              <div className="flex items-center justify-between font-mono text-[0.6rem] uppercase tracking-wider">
                <span className="text-amber-600 dark:text-amber-400">
                  {MATCHUP.a.name.split(" ")[1]}
                </span>
                <span className="text-muted-foreground">Win probability</span>
                <span className="text-muted-foreground">
                  {MATCHUP.b.name.split(" ")[1]}
                </span>
              </div>
              <div className="flex h-3 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-amber-500"
                  style={{ width: `${MATCHUP.a.win}%` }}
                />
              </div>
              <div className="flex items-center justify-between font-mono text-2xl font-bold tabular-nums">
                <span className="text-amber-600 dark:text-amber-400">
                  {MATCHUP.a.win}%
                </span>
                <span className="text-muted-foreground">{MATCHUP.b.win}%</span>
              </div>
              <p className="pt-1 text-center font-mono text-[0.65rem] uppercase tracking-wider text-muted-foreground">
                Jordan won {MATCHUP.a.won} of 1,000
              </p>
            </div>
          </div>
        </section>

        {/* Legendary-matchup ticker */}
        <div className="mt-16 overflow-hidden border-y py-3 [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]">
          <div className="marquee-track flex w-max animate-marquee">
            {[...TICKER, ...TICKER].map((m, i) => (
              <span
                key={i}
                className="flex items-center gap-6 px-6 font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground/60"
              >
                {m}
                <span className="text-amber-500/60">◆</span>
              </span>
            ))}
          </div>
        </div>

        {/* Scoreboard stats */}
        <section className="mt-16 grid grid-cols-3 divide-x divide-border rounded-2xl border bg-card/50">
          {STATS.map((stat) => (
            <CountStat key={stat.label} target={stat.target} label={stat.label} />
          ))}
        </section>

        {/* Modes */}
        <section className="mt-16">
          <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Three ways to play
          </h2>
          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
            {MODES.map((mode) => (
              <Link
                key={mode.to}
                to={mode.to}
                className="group relative flex flex-col overflow-hidden rounded-2xl border bg-card p-6 transition-all hover:-translate-y-1 hover:border-amber-500/40 hover:shadow-xl hover:shadow-amber-500/10"
              >
                <span className="pointer-events-none absolute -right-2 -top-6 select-none font-display text-[7rem] font-black leading-none text-foreground/[0.04]">
                  {mode.figure}
                </span>

                <div className="relative flex items-center justify-between">
                  <div className="flex h-11 w-11 items-center justify-center rounded-lg border bg-muted/50 text-foreground transition-colors group-hover:border-amber-500/40 group-hover:text-amber-500">
                    <mode.icon className="h-5 w-5" />
                  </div>
                  {mode.live ? (
                    <span className="inline-flex items-center gap-1.5 rounded bg-red-600 px-2 py-0.5 font-mono text-[0.6rem] font-medium uppercase tracking-wider text-white">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
                      Live
                    </span>
                  ) : (
                    <span className="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground">
                      {mode.tag}
                    </span>
                  )}
                </div>

                <h3 className="relative mt-5 font-display text-2xl font-bold uppercase tracking-tight">
                  {mode.title}
                </h3>
                <p className="relative mt-2 text-sm leading-relaxed text-muted-foreground">
                  {mode.copy}
                </p>

                <span className="relative mt-6 inline-flex w-fit items-center font-mono text-xs font-medium uppercase tracking-wider">
                  {mode.cta}
                  <span className="absolute -bottom-1 left-0 h-px w-0 bg-amber-500 transition-all duration-300 group-hover:w-full" />
                </span>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}

function CountStat({ target, label }: { target: number; label: string }) {
  const { ref, value } = useCountUp(target)
  return (
    <div className="flex flex-col items-center px-4 py-8 text-center">
      <span
        ref={ref}
        className="font-display text-5xl font-black tabular-nums leading-none sm:text-6xl"
      >
        {value.toLocaleString()}
      </span>
      <span className="mt-2 font-mono text-[0.6rem] uppercase tracking-[0.16em] text-muted-foreground sm:text-xs">
        {label}
      </span>
    </div>
  )
}

export default Home
