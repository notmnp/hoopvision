import { sections } from "@/content/howItWorksContent"
import { Kicker, Rule } from "@/components/editorial"
import { HeaderBackdrop } from "@/components/HeaderBackdrop"
import { TableOfContents } from "@/components/TableOfContents"
import { SectionBlock } from "@/components/SectionBlock"

/**
 * HowItWorksView — the dedicated, fully-static methodology page. Editorial
 * header, a live contents rail pinned to the left on wide screens, and one
 * SectionBlock per section from the content module.
 */
export default function HowItWorksView() {
  return (
    <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-screen-xl flex-col px-4 py-8 md:px-6">
      <header className="relative isolate mb-6 flex flex-col gap-4 pb-6 md:flex-row md:items-end md:justify-between">
        <HeaderBackdrop figure="METHOD" />
        <div>
          <Kicker ruled>The Methodology</Kicker>
          <h1 className="mt-2 display text-5xl sm:text-6xl">How It Works</h1>
          <p className="mt-3 font-condensed text-[0.78rem] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            A layer-by-layer look at how we simulate every matchup
          </p>
        </div>
      </header>
      <Rule weight="double" className="mb-6" />

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[210px_minmax(0,1fr)] lg:gap-14">
        <aside className="lg:row-span-full">
          {/* Mobile/tablet: contents sit at the top of the column */}
          <TableOfContents sections={sections} className="lg:hidden" />
          {/* Desktop: a live rail that pins as you scroll */}
          <div className="sticky top-[5.75rem] mt-3 hidden lg:block">
            <TableOfContents sections={sections} />
          </div>
        </aside>

        <div className="flex min-w-0 flex-col gap-16">
          {sections.map((s) => (
            <SectionBlock key={s.id} section={s} />
          ))}
        </div>
      </div>
    </div>
  )
}
