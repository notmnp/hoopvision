import * as React from "react"
import type { SectionDefinition } from "@/types/howItWorks"
import { Kicker } from "@/components/editorial"
import { cn } from "@/lib/utils"

/**
 * useScrollSpy — tracks which section heading is currently in the reading zone
 * (just below the sticky navbar) via IntersectionObserver and returns its id.
 */
function useScrollSpy(ids: string[]): string | undefined {
  const [activeId, setActiveId] = React.useState<string | undefined>(ids[0])

  React.useEffect(() => {
    if (ids.length === 0) return

    const visible = new Set<string>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id)
          else visible.delete(entry.target.id)
        }
        // The active section is the first one (in document order) whose
        // heading sits within the reading zone.
        const firstVisible = ids.find((id) => visible.has(id))
        if (firstVisible) setActiveId(firstVisible)
      },
      // Top inset clears the 4rem sticky navbar; bottom inset means a heading
      // only counts as "active" once it reaches the upper third of the page.
      { rootMargin: "-88px 0px -62% 0px", threshold: 0 }
    )

    const els = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null)
    els.forEach((el) => observer.observe(el))

    return () => observer.disconnect()
  }, [ids])

  return activeId
}

/**
 * TableOfContents — a live, in-page contents rail. The entry for the section
 * currently being read is highlighted (vermillion tick + ink text) and updates
 * as the reader scrolls. Clicking an entry smooth-scrolls to that section,
 * respecting prefers-reduced-motion.
 */
export function TableOfContents({
  sections,
  className,
}: {
  sections: SectionDefinition[]
  className?: string
}) {
  const ids = React.useMemo(() => sections.map((s) => s.id), [sections])
  const activeId = useScrollSpy(ids)

  if (sections.length === 0) return null

  const handleClick = (
    e: React.MouseEvent<HTMLAnchorElement>,
    id: string
  ) => {
    const el = document.getElementById(id)
    if (!el) return
    e.preventDefault()
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" })
    // Reflect the destination in the URL hash without a second jump.
    history.replaceState(null, "", `#${id}`)
  }

  return (
    <nav aria-label="On this page" className={cn("flex flex-col gap-3", className)}>
      <Kicker tone="muted">
        Contents
      </Kicker>
      <ol className="flex flex-col">
        {sections.map((section, i) => {
          const isActive = section.id === activeId
          return (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                onClick={(e) => handleClick(e, section.id)}
                aria-current={isActive ? "true" : undefined}
                className={cn(
                  "group flex items-baseline gap-2.5 border-l-2 py-1.5 pl-3 transition-colors",
                  isActive
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                <span
                  className={cn(
                    "stat-figure text-xs tabular-nums transition-colors",
                    isActive ? "text-primary" : "text-muted-foreground/70"
                  )}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="font-display text-[0.92rem] font-medium leading-snug">
                  {section.title}
                </span>
              </a>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

export default TableOfContents
