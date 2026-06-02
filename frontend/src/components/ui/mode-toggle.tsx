import { Moon, Sun } from "lucide-react"

import { useTheme } from "@/components/ui/theme-provider"
import { cn } from "@/lib/utils"

const OPTIONS = [
  { key: "light", Icon: Sun, label: "Paper" },
  { key: "dark", Icon: Moon, label: "Ink" },
] as const

/**
 * A compact segmented Paper / Ink theme toggle. Reads the resolved theme
 * (falling back through "system" to the OS preference) and sets light/dark
 * directly — clearer and more tactile than a dropdown.
 */
export function ModeToggle() {
  const { theme, setTheme } = useTheme()

  const resolved =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="inline-flex items-center gap-0.5 rounded-sm border border-border bg-background p-0.5"
    >
      {OPTIONS.map(({ key, Icon, label }) => {
        const active = resolved === key
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => setTheme(key)}
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-[2px] transition-colors",
              active
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="sr-only">{label}</span>
          </button>
        )
      })}
    </div>
  )
}
