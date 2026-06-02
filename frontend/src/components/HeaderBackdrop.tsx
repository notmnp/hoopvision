import { cn } from "@/lib/utils"

/**
 * HeaderBackdrop — the editorial atmosphere layer for a page header, per the
 * house pattern: a halftone dot wash dissolving in from the right, plus one
 * oversized, very faint Fraunces watermark (a "21", "GOAT", a numeral...).
 * The word is monumental and bleeds off the edge, so the header clips it to a
 * sliver of giant type rather than spelling anything out.
 *
 * Rendered absolutely in its own stacking layer behind the header content
 * (pointer-events-none, -z-10), so it never affects positioning. Ink uses
 * theme tokens, so it adapts to Paper and Ink.
 */
export function HeaderBackdrop({
  figure,
  className,
}: {
  figure: string
  className?: string
}) {
  return (
    <>
      {/* dotted halftone wash — bleeds above the top padding so it dissolves
          in from the top-right corner up by the navbar */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 -top-8 -z-10 overflow-hidden",
          className
        )}
      >
        <div
          className="halftone absolute inset-0 opacity-60"
          style={{
            WebkitMaskImage:
              "radial-gradient(130% 130% at 100% 0%, black 0%, transparent 62%)",
            maskImage:
              "radial-gradient(130% 130% at 100% 0%, black 0%, transparent 62%)",
          }}
        />
      </div>

      {/* oversized faint serif watermark — clipped to the header box */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
      >
        <span className="absolute right-3 top-1/2 -translate-y-1/2 select-none font-display text-[6rem] font-black italic leading-none text-foreground/[0.045] sm:text-[8rem] lg:text-[10rem]">
          {figure}
        </span>
      </div>
    </>
  )
}

export default HeaderBackdrop
