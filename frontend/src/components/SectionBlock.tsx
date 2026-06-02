import type { SectionDefinition } from "@/types/howItWorks"
import { TechnicalPanel } from "@/components/TechnicalPanel"
import { Rule } from "@/components/editorial"

/**
 * SectionBlock — a single How It Works section. Renders an anchored heading,
 * the plain-English explanation, and the visually-distinct TechnicalPanel
 * deep-dive directly below it (always visible, no toggle).
 */
export function SectionBlock({ section }: { section: SectionDefinition }) {
  return (
    <section>
      <h2 id={section.id} className="scroll-mt-24 display text-2xl sm:text-3xl">
        {section.title}
      </h2>
      <Rule className="mt-3" />
      <p className="mt-4 text-pretty text-[1.05rem] leading-relaxed text-foreground/85">
        {section.plainEnglish}
      </p>
      <TechnicalPanel technical={section.technical} />
    </section>
  )
}

export default SectionBlock
