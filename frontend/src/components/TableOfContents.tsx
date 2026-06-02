import type { SectionDefinition } from "@/types/howItWorks"
import { Kicker } from "@/components/editorial"

/**
 * TableOfContents — compact in-page navigation listing each section as an
 * anchor link. Clicking scrolls to the matching SectionBlock heading.
 */
export function TableOfContents({ sections }: { sections: SectionDefinition[] }) {
  if (sections.length === 0) return null

  return (
    <nav
      aria-label="On this page"
      className="rounded-sm border border-foreground/15 bg-muted/40 p-5"
    >
      <Kicker ruled className="mb-3 block">
        On This Page
      </Kicker>
      <ol className="flex flex-col gap-2">
        {sections.map((section, i) => (
          <li key={section.id} className="flex items-baseline gap-3">
            <span className="stat-figure text-sm text-muted-foreground tabular-nums">
              {String(i + 1).padStart(2, "0")}
            </span>
            <a
              href={`#${section.id}`}
              className="font-display text-[0.95rem] font-medium text-foreground/80 underline-offset-[5px] decoration-1 transition-colors hover:text-foreground hover:underline hover:decoration-border"
            >
              {section.title}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  )
}

export default TableOfContents
