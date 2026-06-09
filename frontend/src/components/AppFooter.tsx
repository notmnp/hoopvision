import { Link } from "react-router-dom"

import { Kicker } from "@/components/editorial"

/**
 * App-wide colophon rendered outside the route outlet (see How It Works
 * blueprint, #AppFooter) so every present and future route carries the
 * footer — and its "How It Works" link — without per-route wiring.
 */
function AppFooter() {
  return (
    <div className="mx-auto w-full max-w-screen-xl px-4 md:px-6">
      <footer className="flex flex-col gap-3 border-t border-foreground/15 py-8 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-lg text-sm leading-relaxed text-foreground/65">
          Every verdict is simulated from real per-possession NBA tendencies,
          with each player frozen to the season you choose.{" "}
          <Link
            to="/how-it-works"
            className="font-medium text-foreground underline decoration-border underline-offset-[5px] transition-colors hover:text-primary hover:decoration-primary"
          >
            See how it works
          </Link>
        </p>
        <div className="flex items-center gap-4">
          <a
            href="https://x.com/notmnp"
            target="_blank"
            rel="noreferrer noopener"
            className="transition-colors hover:text-foreground"
          >
            <Kicker tone="muted">X</Kicker>
          </a>
          <a
            href="https://github.com/notmnp"
            target="_blank"
            rel="noreferrer noopener"
            className="transition-colors hover:text-foreground"
          >
            <Kicker tone="muted">GitHub</Kicker>
          </a>
        </div>
      </footer>
    </div>
  )
}

export default AppFooter
