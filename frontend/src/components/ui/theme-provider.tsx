import { createContext, useContext, useEffect, useState } from "react"

type Theme = "dark" | "light" | "system"

type ThemeProviderProps = {
  children: React.ReactNode
  defaultTheme?: Theme
  storageKey?: string
}

type ThemeProviderState = {
  theme: Theme
  setTheme: (theme: Theme) => void
}

const initialState: ThemeProviderState = {
  theme: "system",
  setTheme: () => null,
}

const ThemeProviderContext = createContext<ThemeProviderState>(initialState)

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "vite-ui-theme",
  ...props
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem(storageKey) as Theme) || defaultTheme
  )

  useEffect(() => {
    const root = window.document.documentElement

    // Kill CSS transitions for the single frame the theme class swaps, so every
    // color token flips instantly instead of fading. Without this, elements with
    // `transition-colors`/`transition-all` (e.g. the draft "on the clock" panel's
    // `duration-500`) slowly cross-fade on every theme toggle. Hover effects and
    // the draft draw-reveal animation aren't theme-driven, so they're unaffected.
    const disableTransitions = document.createElement("style")
    disableTransitions.appendChild(
      document.createTextNode(
        "*,*::before,*::after{transition:none !important}"
      )
    )
    document.head.appendChild(disableTransitions)

    root.classList.remove("light", "dark")

    if (theme === "system") {
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
        .matches
        ? "dark"
        : "light"

      root.classList.add(systemTheme)
    } else {
      root.classList.add(theme)
    }

    // Force a synchronous style flush so the class change commits with
    // transitions disabled, then re-enable them on the next tick.
    window.getComputedStyle(document.body)
    const timer = window.setTimeout(() => {
      document.head.removeChild(disableTransitions)
    }, 1)

    return () => {
      window.clearTimeout(timer)
      if (disableTransitions.parentNode) {
        disableTransitions.parentNode.removeChild(disableTransitions)
      }
    }
  }, [theme])

  const value = {
    theme,
    setTheme: (theme: Theme) => {
      localStorage.setItem(storageKey, theme)
      setTheme(theme)
    },
  }

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  )
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext)

  if (context === undefined)
    throw new Error("useTheme must be used within a ThemeProvider")

  return context
}
