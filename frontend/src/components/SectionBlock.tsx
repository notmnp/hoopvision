import type { SectionDefinition } from "@/types/howItWorks"
import { TechnicalPanel } from "@/components/TechnicalPanel"

/**
 * SectionBlock — a single How It Works section. Renders an anchored heading,
 * the plain-English explanation, and the visually-distinct TechnicalPanel
 * deep-dive directly below it (always visible, no toggle).
 */
export function SectionBlock({ section }: { section: SectionDefinition }) {
  return (
    <section className="scroll-mt-24">
      <h2
        id={section.id}
        className="display text-2xl sm:text-3xl"
      >
        {section.title}
      </h2>
      <p className="mt-3 max-w-prose text-base leading-relaxed text-foreground/85">
        {section.plainEnglish}
      </p>
      <TechnicalPanel technical={section.technical} />
    </section>
  )
}

export default SectionBlock
