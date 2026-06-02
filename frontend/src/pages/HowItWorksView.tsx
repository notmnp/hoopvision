import { sections } from "@/content/howItWorksContent"
import { Kicker, Rule } from "@/components/editorial"
import { TableOfContents } from "@/components/TableOfContents"
import { SectionBlock } from "@/components/SectionBlock"

/**
 * HowItWorksView — the dedicated, fully-static methodology page. Renders a
 * page title, an introductory paragraph, a table of contents, and one
 * SectionBlock per section from the content module.
 */
export default function HowItWorksView() {
  return (
    <main className="mx-auto w-full max-w-screen-md px-4 py-12 md:px-6 md:py-16">
      <header className="flex flex-col gap-3">
        <Kicker ruled>Methodology</Kicker>
        <h1 className="display text-4xl sm:text-5xl">How It Works</h1>
        <p className="max-w-prose text-base leading-relaxed text-muted-foreground">
          HoopVision pits players and teams across eras against one another with a
          simulation engine built on normalized historical data. This page breaks
          down that methodology layer by layer — a plain-English read for the
          curious fan, and the equations, pseudocode, and tables underneath for
          anyone who wants the full technical picture.
        </p>
        <Rule weight="double" className="mt-2" />
      </header>

      <div className="mt-8">
        <TableOfContents sections={sections} />
      </div>

      <div className="mt-12 flex flex-col gap-14">
        {sections.map((s) => (
          <SectionBlock key={s.id} section={s} />
        ))}
      </div>
    </main>
  )
}
