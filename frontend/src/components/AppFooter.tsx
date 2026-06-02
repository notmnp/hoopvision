import { Link } from "react-router-dom"

/**
 * AppFooter — persistent editorial footer mounted app-wide in main.tsx.
 * Carries the "How It Works" methodology link plus a masthead tagline.
 */
export function AppFooter() {
  return (
    <footer className="mt-16 w-full border-t-2 border-foreground/80 bg-background">
      <div className="mx-auto flex w-full max-w-screen-xl flex-col gap-4 px-4 py-8 md:flex-row md:items-center md:justify-between md:px-6">
        <div className="flex flex-col gap-1 leading-none">
          <span className="masthead text-lg text-foreground">HOOPER</span>
          <span className="kicker text-muted-foreground">The Matchup Issue</span>
        </div>

        <nav className="flex items-center gap-6">
          <Link
            to="/how-it-works"
            className="font-display text-[0.9rem] font-medium leading-none text-foreground/70 underline-offset-[7px] decoration-1 transition-colors hover:text-foreground hover:underline hover:decoration-border"
          >
            How It Works
          </Link>
        </nav>

        <p className="font-display text-[0.8rem] text-muted-foreground">
          © {new Date().getFullYear()} HoopVision. For the love of the game.
        </p>
      </div>
    </footer>
  )
}

export default AppFooter
