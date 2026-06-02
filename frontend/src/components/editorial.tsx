import * as React from "react"
import { cn } from "@/lib/utils"

/* ============================================================
   HOOPER editorial kit — "The Matchup Issue"
   Shared magazine primitives: Kicker, Rule, SectionHeader,
   Masthead, StatFigure, HalftoneAvatar.
   ============================================================ */

type KickerTone = "primary" | "ink" | "muted" | "court"

const TONE: Record<KickerTone, string> = {
  primary: "text-primary",
  ink: "text-foreground",
  muted: "text-muted-foreground",
  court: "text-court",
}

export function Kicker({
  children,
  ruled = false,
  tone = "primary",
  className,
  ...props
}: React.ComponentProps<"span"> & {
  ruled?: boolean
  tone?: KickerTone
}) {
  return (
    <span
      className={cn(
        "kicker",
        ruled && "kicker-ruled",
        TONE[tone],
        className
      )}
      {...props}
    >
      {children}
    </span>
  )
}

export function Rule({
  weight = "hair",
  vertical = false,
  className,
}: {
  weight?: "hair" | "thick" | "double"
  vertical?: boolean
  className?: string
}) {
  if (vertical) {
    return (
      <span
        aria-hidden
        className={cn(
          "inline-block w-px self-stretch bg-border",
          weight === "thick" && "w-0.5 bg-foreground/70",
          className
        )}
      />
    )
  }
  return (
    <hr
      className={cn(
        "rule",
        weight === "thick" && "rule-thick",
        weight === "double" && "rule-double",
        className
      )}
    />
  )
}

export function SectionHeader({
  kicker,
  title,
  lede,
  action,
  rule = true,
  className,
}: {
  kicker?: string
  title?: React.ReactNode
  lede?: React.ReactNode
  action?: React.ReactNode
  rule?: boolean
  className?: string
}) {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1.5">
          {kicker && <Kicker ruled>{kicker}</Kicker>}
          {title && (
            <h2 className="display text-3xl sm:text-4xl">{title}</h2>
          )}
          {lede && (
            <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
              {lede}
            </p>
          )}
        </div>
        {action}
      </div>
      {rule && <Rule weight="double" />}
    </div>
  )
}

export function Masthead({
  issue = "The Matchup Issue",
  detail,
  className,
}: {
  issue?: string
  detail?: string
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 font-condensed text-[0.7rem] uppercase tracking-[0.1em] text-muted-foreground",
        className
      )}
    >
      <span className="font-semibold text-foreground">HOOPER</span>
      <span className="hidden sm:inline">{issue}</span>
      {detail && <span className="tabular-nums">{detail}</span>}
    </div>
  )
}

export function StatFigure({
  value,
  label,
  caption,
  size = "md",
  align = "center",
  className,
}: {
  value: React.ReactNode
  label?: string
  caption?: React.ReactNode
  size?: "sm" | "md" | "lg"
  align?: "left" | "center"
  className?: string
}) {
  const sizes = {
    sm: "text-3xl",
    md: "text-5xl sm:text-6xl",
    lg: "text-6xl sm:text-7xl lg:text-8xl",
  }
  return (
    <div
      className={cn(
        "flex flex-col gap-2",
        align === "center" ? "items-center text-center" : "items-start",
        className
      )}
    >
      <span className={cn("stat-figure", sizes[size])}>{value}</span>
      {label && <Kicker tone="muted">{label}</Kicker>}
      {caption && (
        <span className="max-w-[22ch] font-display text-sm italic leading-snug text-muted-foreground">
          {caption}
        </span>
      )}
    </div>
  )
}

/**
 * HalftoneAvatar — player headshot rendered as a printed, duotone cutout
 * with a vermillion (or team) accent on hover. Used app-wide for players.
 */
export function HalftoneAvatar({
  src,
  alt,
  fallback,
  size = 48,
  accent,
  active = false,
  revealOnGroupHover = false,
  className,
}: {
  src?: string
  alt: string
  fallback?: React.ReactNode
  size?: number
  accent?: string
  active?: boolean
  /** Un-desaturate (and accent the border) when the nearest `.group` ancestor
   *  is hovered — e.g. a list row that should "light up" its players on hover. */
  revealOnGroupHover?: boolean
  className?: string
}) {
  const [errored, setErrored] = React.useState(false)
  return (
    <span
      className={cn(
        "group/ht relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-sm border bg-newsprint transition-colors",
        active ? "border-primary" : "border-foreground/20",
        revealOnGroupHover && "group-hover:border-primary",
        className
      )}
      style={{
        width: size,
        height: size,
        ...(active && accent ? { borderColor: accent } : {}),
      }}
    >
      {/* halftone print field behind the cutout */}
      <span className="halftone pointer-events-none absolute inset-0 opacity-60" aria-hidden />
      {src && !errored ? (
        <img
          src={src}
          alt={alt}
          onError={() => setErrored(true)}
          className={cn(
            "relative h-full w-full object-cover object-top transition-all duration-300",
            "duotone group-hover/ht:grayscale-0 group-hover/ht:[filter:none]",
            revealOnGroupHover && "group-hover:grayscale-0 group-hover:[filter:none]",
            active && "grayscale-0 [filter:none]"
          )}
        />
      ) : (
        <span className="relative font-display text-sm font-bold uppercase text-muted-foreground">
          {fallback ?? alt.slice(0, 2)}
        </span>
      )}
    </span>
  )
}
