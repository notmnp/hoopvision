import { useState } from "react"
import { Link, NavLink } from "react-router-dom"
import { Menu } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ModeToggle } from "@/components/ui/mode-toggle"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { useTheme } from "@/components/ui/theme-provider"
import { cn } from "@/lib/utils"

const NAV_ITEMS = [
  { to: "/live", label: "Live Scores" },
  { to: "/simulate", label: "Simulator" },
  { to: "/bracket", label: "GOAT Bracket" },
  { to: "/teams", label: "Teams" },
  { to: "/predictions", label: "Predictions" },
]

export function Navbar() {
  const { theme } = useTheme()
  const [mobileOpen, setMobileOpen] = useState(false)

  const logoSrc =
    theme === "dark" ? "/img/logo_white.svg" : "/img/logo_black.svg"

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-16 w-full max-w-screen-xl items-center justify-between px-4 md:px-6">
        <Link to="/" className="flex items-center" aria-label="IsoLab home">
          <img src={logoSrc} alt="IsoLab" className="h-8 w-8" />
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                  isActive && "text-foreground"
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
          <div className="ml-2">
            <ModeToggle />
          </div>
        </nav>

        <div className="flex items-center gap-2 md:hidden">
          <ModeToggle />
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Open menu">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72">
              <SheetHeader>
                <SheetTitle>
                  <img src={logoSrc} alt="IsoLab" className="h-9 w-9" />
                </SheetTitle>
              </SheetHeader>
              <nav className="mt-2 flex flex-col gap-1 px-2">
                {NAV_ITEMS.map((item) => (
                  <SheetClose asChild key={item.to}>
                    <NavLink
                      to={item.to}
                      className={({ isActive }) =>
                        cn(
                          "rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                          isActive && "bg-accent text-foreground"
                        )
                      }
                    >
                      {item.label}
                    </NavLink>
                  </SheetClose>
                ))}
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  )
}

export default Navbar
