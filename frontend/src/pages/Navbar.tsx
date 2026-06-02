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
  { to: "/simulate", label: "Simulate a 1v1" },
  { to: "/bracket", label: "Create a Bracket" },
  { to: "/live", label: "Live Scores" },
]

const navClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    "font-display text-[0.9rem] font-medium leading-none transition-colors",
    "underline-offset-[7px] decoration-1 hover:underline hover:decoration-border",
    isActive
      ? "text-primary underline decoration-primary hover:decoration-primary"
      : "text-foreground/70 hover:text-foreground"
  )

export function Navbar() {
  const { theme } = useTheme()
  const [mobileOpen, setMobileOpen] = useState(false)

  const logoSrc =
    theme === "dark" ? "/img/logo_white.svg" : "/img/logo_black.svg"

  return (
    <header className="sticky top-0 z-50 w-full border-b-2 border-foreground/80 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <div className="mx-auto flex h-16 w-full max-w-screen-xl items-center justify-between gap-4 px-4 md:px-6">
        <Link
          to="/"
          className="flex items-center gap-2.5"
          aria-label="Hooper home"
        >
          <img src={logoSrc} alt="" className="h-7 w-7" />
          <span className="flex flex-col leading-none">
            <span className="masthead text-xl text-foreground">HOOPER</span>
            <span className="kicker -mt-0.5 hidden text-muted-foreground sm:inline-flex">
              The Matchup Issue
            </span>
          </span>
        </Link>

        <nav className="hidden items-center gap-6 md:flex">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} className={navClass}>
              {item.label}
            </NavLink>
          ))}
          <span className="ml-1 h-5 w-px bg-border" />
          <ModeToggle />
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
                <SheetTitle className="flex items-center gap-2.5">
                  <img src={logoSrc} alt="" className="h-8 w-8" />
                  <span className="masthead text-xl">HOOPER</span>
                </SheetTitle>
              </SheetHeader>
              <nav className="mt-4 flex flex-col gap-1 px-4">
                {NAV_ITEMS.map((item) => (
                  <SheetClose asChild key={item.to}>
                    <NavLink
                      to={item.to}
                      className={({ isActive }) =>
                        cn(
                          "flex items-center gap-3 border-b border-border py-3 font-display text-xl font-medium transition-colors hover:text-foreground",
                          isActive ? "text-primary" : "text-foreground/80"
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <span
                            className={cn(
                              "h-3.5 w-0.5",
                              isActive ? "bg-primary" : "bg-transparent"
                            )}
                          />
                          {item.label}
                        </>
                      )}
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
