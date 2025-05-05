import { useState } from "react"
import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { ModeToggle } from "@/components/ui/mode-toggle"
import { Menu, X } from "lucide-react"
import { useTheme } from "@/components/ui/theme-provider"

export function Navbar() {
  const { theme } = useTheme()
  const [mobileOpen, setMobileOpen] = useState(false)

  const logoSrc =
    theme === "dark" ? "/img/logo_white.svg" : "/img/logo_black.svg"

  return (
    <header className="w-full border-b relative z-50">
      <div className="flex h-16 items-center justify-between px-4 md:px-6 mx-auto w-full max-w-screen-xl">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2">
          <img src={logoSrc} alt="Hoopvision logo" className="h-6 w-6" />
          <span className="text-lg font-bold">Hoopvision</span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-6">
          <Link to="/about" className="text-sm font-medium hover:underline">
            About
          </Link>
          <Link to="/teams" className="text-sm font-medium hover:underline">
            Teams
          </Link>
          <Link to="/predictions" className="text-sm font-medium hover:underline">
            Predictions
          </Link>
          <ModeToggle />
        </nav>

        {/* Mobile toggle */}
        <div className="md:hidden flex items-center gap-2">
          <ModeToggle />
          <Button variant="ghost" size="icon" onClick={() => setMobileOpen(!mobileOpen)}>
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </div>

      {/* Mobile menu (appears below navbar) */}
      {mobileOpen && (
        <div className="absolute top-full left-0 right-0 bg-background border-t border-b md:hidden px-4 py-4 space-y-3 shadow-lg z-40">
          <Link
            to="/about"
            onClick={() => setMobileOpen(false)}
            className="block text-sm font-medium hover:underline"
          >
            About
          </Link>
          <Link
            to="/teams"
            onClick={() => setMobileOpen(false)}
            className="block text-sm font-medium hover:underline"
          >
            Teams
          </Link>
          <Link
            to="/predictions"
            onClick={() => setMobileOpen(false)}
            className="block text-sm font-medium hover:underline"
          >
            Predictions
          </Link>
        </div>
      )}
    </header>
  )
}

export default Navbar