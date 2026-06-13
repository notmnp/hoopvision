import { Link } from "react-router-dom"

import { Kicker } from "@/components/editorial"

/**
 * Colophon footer with the "How It Works" link and social links. Expects the
 * page's own container for width/padding (e.g. Home's max-w-screen-xl wrapper).
 */
function AppFooter() {
  return (
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
  )
}

export default AppFooter
