import { Link } from "react-router-dom"
import { Activity, ArrowRight, ArrowUpRight, Swords, Trophy } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Kicker, Rule, StatFigure, HalftoneAvatar } from "@/components/editorial"
import { peakSeason } from "@/lib/peakSeasons"

const HEADSHOT = (id: number) =>
  `https://cdn.nba.com/headshots/nba/latest/260x190/${id}.png`

/** Deep-link into ISO Lab with both fighters preloaded at their peak seasons. */
const bout = (a: string, b: string) => {
  const params = new URLSearchParams({ a, b })
  const sa = peakSeason(a)
  const sb = peakSeason(b)
  if (sa) params.set("sa", sa)
  if (sb) params.set("sb", sb)
  return `/simulate?${params.toString()}`
}

/**
 * The cover-lines: the great debates, each a one-tap ticket into a
 * preloaded simulation. `odds` is the implied verdict (a%–b%).
 */
const DEBATES = [
  {
    a: { name: "Michael Jordan", short: "Jordan", id: 893 },
    b: { name: "LeBron James", short: "LeBron", id: 2544 },
    note: "GOAT",
  },
  {
    a: { name: "Kobe Bryant", short: "Kobe", id: 977 },
    b: { name: "Kevin Durant", short: "Durant", id: 201142 },
    note: "Pure hoops",
  },
  {
    a: { name: "Stephen Curry", short: "Curry", id: 201939 },
    b: { name: "Magic Johnson", short: "Magic", id: 77142 },
    note: "Best PG?",
  },
  {
    a: { name: "Allen Iverson", short: "Iverson", id: 947 },
    b: { name: "Kyrie Irving", short: "Kyrie", id: 202681 },
    note: "Iso gods",
  },
  {
    a: { name: "Shaquille O'Neal", short: "Shaq", id: 406 },
    b: { name: "Nikola Jokic", short: "Jokic", id: 203999 },
    note: "Diesel vs. Joker",
  },
]

const DEPARTMENTS = [
  {
    to: "/simulate",
    figure: "01",
    icon: Swords,
    kicker: "Simulation",
    title: "ISO Lab",
    copy: "Stage any one-on-one and run it a thousand times.",
    cta: "Step in",
  },
  {
    to: "/bracket",
    figure: "02",
    icon: Trophy,
    kicker: "Tournaments",
    title: "GOAT Bracket",
    copy: "Seed a field of legends and crown a single champion.",
    cta: "Draft the field",
  },
  {
    to: "/live",
    figure: "03",
    icon: Activity,
    kicker: "The Wire",
    title: "Live Scores",
    copy: "Tonight's games and leaders, as they happen.",
    cta: "Tonight's slate",
    live: true,
  },
]

const STATS = [
  { value: "1,000", label: "Sims per matchup", note: "the law of large numbers" },
  { value: "16", label: "Legends per bracket", note: "five rounds, one champion" },
  { value: "21", label: "Points to win", note: "win by two — playground rules" },
]

function reveal(delay: number) {
  return {
    className:
      "animate-in fade-in slide-in-from-bottom-3 duration-700 [animation-fill-mode:both]",
    style: { animationDelay: `${delay}ms` },
  }
}

const Home = () => {
  return (
    <div className="mx-auto w-full max-w-screen-xl px-4 md:px-6">
      {/* ── THE COVER ──────────────────────────────────────────── */}
      <section className="relative grid grid-cols-1 items-center gap-x-12 gap-y-12 overflow-hidden py-14 lg:grid-cols-12 lg:py-24">
        {/* Atmosphere: a printed halftone tone bleeding from the top-right, and
            an oversized "1-ON-1" watermark — names the format, fills the cover. */}
        <div
          aria-hidden
          className="halftone-splash pointer-events-none absolute inset-0 -z-10"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute -bottom-12 left-1/2 -z-10 hidden -translate-x-1/2 select-none font-display text-[12rem] font-black italic leading-none text-foreground/[0.045] lg:block xl:text-[14rem]"
        >
          1-ON-1
        </span>

        {/* Cover story */}
        <div className="relative z-10 flex flex-col items-start lg:col-span-6 lg:pr-6">
          <div {...reveal(0)}>
            <Kicker ruled>Settle it on the hardwood</Kicker>
          </div>

          <h1
            {...reveal(100)}
            className="display mt-6 text-[3.5rem] leading-[0.9] sm:text-[5rem] lg:text-[6.25rem]"
          >
            Who you
            <br />
            got<span className="text-primary">?</span>
          </h1>

          <p
            {...reveal(200)}
            className="mt-10 max-w-md text-pretty font-display text-xl italic leading-relaxed text-muted-foreground"
          >
            Pick any two legends, any era. Hooper runs their one-on-one a
            thousand times on real NBA tendencies — then hands you the verdict.
          </p>

          <div {...reveal(300)} className="mt-6 flex flex-wrap items-center gap-3">
            <Button
              asChild
              size="lg"
              className="group font-condensed font-bold uppercase tracking-[0.14em]"
            >
              <Link to="/simulate">
                <Swords className="size-4" />
                Run a matchup
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="group font-condensed font-bold uppercase tracking-[0.14em]"
            >
              <Link to="/bracket">
                <Trophy className="size-4" />
                Build a bracket
              </Link>
            </Button>
          </div>

          <div {...reveal(380)} className="mt-8 flex items-center gap-2">
            <Kicker tone="muted">
              1,000 sims · real NBA tendencies · first to 21
            </Kicker>
          </div>
        </div>

        {/* Cover-lines: the debates worth settling — pasted onto the page like
            a hand-placed sticker (opaque die-cut card, a slight tilt, a hard
            print-offset shadow, and a corner seal). Straightens on hover. */}
        <div {...reveal(240)} className="relative z-10 lg:col-span-5">
          <div className="group/sticker relative -rotate-[1.5deg] rounded-sm border border-border bg-card p-5 shadow-[3px_4px_0_oklch(0_0_0/0.18)] transition-transform duration-300 ease-out hover:rotate-0 sm:p-6">
            {/* Die-cut corner seal */}
            <span
              aria-hidden
              className="absolute -right-3.5 -top-3.5 z-10 flex size-[3.25rem] rotate-[14deg] flex-col items-center justify-center rounded-full border-2 border-primary bg-card text-center font-condensed text-[0.55rem] font-black uppercase leading-[1.05] tracking-[0.1em] text-primary shadow-[2px_2px_0_oklch(0_0_0/0.14)] transition-transform duration-300 group-hover/sticker:rotate-[6deg]"
            >
              The
              <br />
              Card
            </span>

            <div className="flex items-end justify-between gap-3">
              <h2 className="display text-2xl">Debates worth settling</h2>
              <span className="hidden font-display text-sm italic text-foreground/55 sm:block">
                tap to load →
              </span>
            </div>

            <Rule weight="thick" className="mt-4" />

          <ul>
            {DEBATES.map((d, i) => (
              <li key={`${d.a.id}-${d.b.id}`}>
                <Link
                  to={bout(d.a.name, d.b.name)}
                  className="group flex items-center gap-4 border-b border-border py-3.5 transition-colors hover:bg-muted/50"
                >
                  <span className="w-6 shrink-0 font-display text-base font-black tabular-nums text-foreground/30">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="flex shrink-0 items-center">
                    <HalftoneAvatar
                      src={HEADSHOT(d.a.id)}
                      alt={d.a.short}
                      fallback={d.a.short.slice(0, 2)}
                      size={34}
                      revealOnGroupHover
                    />
                    <HalftoneAvatar
                      src={HEADSHOT(d.b.id)}
                      alt={d.b.short}
                      fallback={d.b.short.slice(0, 2)}
                      size={34}
                      revealOnGroupHover
                      className="-ml-2 ring-1 ring-card"
                    />
                  </span>
                  <span className="min-w-0 flex-1 font-display text-base font-bold leading-tight">
                    {d.a.short}{" "}
                    <span className="text-foreground/40">vs.</span> {d.b.short}
                  </span>
                  <span className="hidden shrink-0 font-condensed text-[0.7rem] font-bold uppercase tracking-[0.08em] text-foreground/45 sm:block">
                    {d.note}
                  </span>
                  <ArrowUpRight className="size-4 shrink-0 text-foreground/30 transition-all group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-primary" />
                </Link>
              </li>
            ))}
          </ul>
          </div>
        </div>
      </section>

      {/* ── BY THE NUMBERS ─────────────────────────────────────── */}
      <section className="border-t-2 border-foreground/80 py-12">
        <Kicker ruled>By the numbers</Kicker>
        <div className="mt-8 grid grid-cols-1 divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {STATS.map((s) => (
            <div key={s.label} className="px-1 py-6 sm:px-8 sm:py-1">
              <StatFigure
                value={s.value}
                label={s.label}
                caption={s.note}
                align="left"
                size="md"
              />
            </div>
          ))}
        </div>
      </section>

      {/* ── THE DEPARTMENTS ────────────────────────────────────── */}
      <section className="border-t-2 border-foreground/80 py-12">
        <Kicker ruled>Inside the issue</Kicker>
        <div className="mt-7 grid grid-cols-1 gap-px overflow-hidden border border-border bg-border sm:grid-cols-3">
          {DEPARTMENTS.map((dept) => (
            <Link
              key={dept.to}
              to={dept.to}
              className="group relative flex flex-col bg-card p-6 transition-colors hover:bg-muted/40"
            >
              <span
                aria-hidden
                className="stat-figure pointer-events-none absolute right-4 top-3 select-none text-5xl leading-none text-foreground/[0.1] transition-colors group-hover:text-primary/20"
              >
                {dept.figure}
              </span>
              <div className="relative flex items-center gap-2.5">
                <dept.icon className="size-5 text-primary" />
                {dept.live ? (
                  <span className="ml-auto inline-flex items-center gap-1.5 bg-primary px-2 py-0.5 text-[0.7rem] font-bold uppercase tracking-[0.08em] text-primary-foreground">
                    <span className="size-1.5 animate-pulse rounded-full bg-current" />
                    Live
                  </span>
                ) : (
                  <Kicker tone="muted">{dept.kicker}</Kicker>
                )}
              </div>
              <h3 className="relative mt-4 font-display text-2xl font-bold uppercase leading-none">
                {dept.title}
              </h3>
              <p className="relative mt-2 flex-1 text-sm leading-relaxed text-foreground/70">
                {dept.copy}
              </p>
              <span className="relative mt-5 inline-flex items-center gap-1.5 font-condensed text-xs font-bold uppercase tracking-[0.12em] text-foreground">
                {dept.cta}
                <ArrowRight className="size-3.5 text-primary transition-transform group-hover:translate-x-1" />
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* ── COLOPHON ───────────────────────────────────────────── */}
      <footer className="flex flex-col gap-3 border-t border-foreground/15 py-8 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-lg text-sm leading-relaxed text-foreground/65">
          Every verdict is simulated from real per-possession NBA tendencies,
          with each player frozen to the season you choose.
        </p>
        <Kicker tone="muted">Data · stats.nba.com</Kicker>
      </footer>
    </div>
  )
}

export default Home
