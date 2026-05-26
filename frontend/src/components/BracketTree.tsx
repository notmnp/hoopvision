import * as React from "react"
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"

import { roundName } from "@/lib/bracket"
import { cn } from "@/lib/utils"

export type BracketSide = "left" | "center" | "right"

export interface BracketTreeRound<M> {
  round_number: number
  matchups: M[]
}

interface MatchupContext {
  roundNumber: number
  side: BracketSide
  // Index of this matchup within its full round (not within the side slice), so
  // callers can map a rendered cell back to its source data.
  matchupIndex: number
}

interface BracketTreeProps<M> {
  rounds: BracketTreeRound<M>[]
  renderMatchup: (matchup: M, ctx: MatchupContext) => React.ReactNode
  // Width of each round column. Defaults to a comfortable card width that keeps
  // an 8-player bracket within the page's max width without horizontal scroll.
  columnClassName?: string
}

interface Column<M> {
  key: string
  roundNumber: number
  side: BracketSide
  // [matchup, indexInRound] pairs so renderMatchup gets a stable global index.
  entries: { matchup: M; matchupIndex: number }[]
}

interface Connector {
  d: string
}

// A measured L-shaped path between a matchup and the next-round slot it feeds.
// Measuring real DOM positions (rather than assuming evenly spaced cells) keeps
// the lines aligned even when cards differ in height — e.g. a decided matchup
// carrying a "View Series" button sits taller than an undecided one.
function buildConnectors(
  root: HTMLElement,
  cells: Map<string, HTMLElement>,
  rounds: { matchups: unknown[] }[]
): Connector[] {
  const rootRect = root.getBoundingClientRect()
  const totalRounds = rounds.length
  const paths: Connector[] = []

  const edges = (key: string) => {
    const el = cells.get(key)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return {
      left: r.left - rootRect.left,
      right: r.right - rootRect.left,
      cy: r.top - rootRect.top + r.height / 2,
    }
  }

  // Every matchup k in round r feeds matchup floor(k/2) in round r+1.
  for (let round = 1; round <= totalRounds - 1; round++) {
    const count = rounds[round - 1].matchups.length
    for (let k = 0; k < count; k++) {
      const src = edges(`${round}-${k}`)
      const dst = edges(`${round + 1}-${Math.floor(k / 2)}`)
      if (!src || !dst) continue

      if (dst.left >= src.right) {
        // Next slot sits to the right (left half of the bracket fanning in).
        const midX = (src.right + dst.left) / 2
        paths.push({ d: `M ${src.right} ${src.cy} H ${midX} V ${dst.cy} H ${dst.left}` })
      } else {
        // Next slot sits to the left (right half mirroring inward).
        const midX = (src.left + dst.right) / 2
        paths.push({ d: `M ${src.left} ${src.cy} H ${midX} V ${dst.cy} H ${dst.right}` })
      }
    }
  }

  return paths
}

// Arranges a single-elimination bracket NBA-style: the first half of every
// round's matchups fans out down the left, the second half mirrors down the
// right, and the lone final sits in the center. Because each round's matchups
// feed forward as `index // 2`, splitting every round at its midpoint keeps a
// finalist's entire subtree on one side.
export function BracketTree<M>({
  rounds,
  renderMatchup,
  columnClassName = "w-52 shrink-0",
}: BracketTreeProps<M>) {
  const totalRounds = rounds.length
  const columns: Column<M>[] = []

  const half = (count: number) => Math.floor(count / 2)

  // Left side: rounds 1..T-1, top half of each round.
  for (let r = 1; r <= totalRounds - 1; r++) {
    const matchups = rounds[r - 1].matchups
    const cut = half(matchups.length)
    columns.push({
      key: `L${r}`,
      roundNumber: r,
      side: "left",
      entries: matchups
        .slice(0, cut)
        .map((matchup, i) => ({ matchup, matchupIndex: i })),
    })
  }

  // Center: the final (single matchup of the last round).
  columns.push({
    key: "final",
    roundNumber: totalRounds,
    side: "center",
    entries: rounds[totalRounds - 1].matchups.map((matchup, i) => ({
      matchup,
      matchupIndex: i,
    })),
  })

  // Right side: rounds T-1..1 in reverse, bottom half of each round.
  for (let r = totalRounds - 1; r >= 1; r--) {
    const matchups = rounds[r - 1].matchups
    const cut = half(matchups.length)
    columns.push({
      key: `R${r}`,
      roundNumber: r,
      side: "right",
      entries: matchups
        .slice(cut)
        .map((matchup, i) => ({ matchup, matchupIndex: cut + i })),
    })
  }

  const rootRef = useRef<HTMLDivElement>(null)
  const cellRefs = useRef(new Map<string, HTMLElement>())
  const [connectors, setConnectors] = useState<Connector[]>([])
  const [dims, setDims] = useState({ w: 0, h: 0 })

  const setCellRef = useCallback(
    (key: string) => (el: HTMLDivElement | null) => {
      if (el) cellRefs.current.set(key, el)
      else cellRefs.current.delete(key)
    },
    []
  )

  const measure = useCallback(() => {
    const root = rootRef.current
    if (!root) return
    setConnectors(buildConnectors(root, cellRefs.current, rounds))
    setDims({ w: root.offsetWidth, h: root.offsetHeight })
  }, [rounds])

  // Measure synchronously after layout so the lines paint with the cards (no
  // first-frame flash), then keep them in sync as the bracket grows/reflows.
  useLayoutEffect(() => {
    measure()
  }, [measure])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const observer = new ResizeObserver(() => measure())
    observer.observe(root)
    window.addEventListener("resize", measure)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", measure)
    }
  }, [measure])

  return (
    <div
      ref={rootRef}
      className="relative flex min-w-max items-stretch justify-center gap-6"
    >
      <svg
        className="pointer-events-none absolute inset-0 z-0 h-full w-full overflow-visible text-border"
        width={dims.w}
        height={dims.h}
        aria-hidden
      >
        {connectors.map((connector, index) => (
          <path
            key={index}
            d={connector.d}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinejoin="round"
          />
        ))}
      </svg>

      {columns.map((column) => (
        <div
          key={column.key}
          className={cn("relative z-10 flex flex-col", columnClassName)}
        >
          <div className="mb-3 text-center font-display text-sm font-medium uppercase tracking-wider text-muted-foreground">
            {roundName(column.roundNumber, totalRounds)}
          </div>
          <div className="flex flex-1 flex-col justify-around gap-4">
            {column.entries.map(({ matchup, matchupIndex }) => (
              <div
                key={matchupIndex}
                ref={setCellRef(`${column.roundNumber}-${matchupIndex}`)}
              >
                {renderMatchup(matchup, {
                  roundNumber: column.roundNumber,
                  side: column.side,
                  matchupIndex,
                })}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
