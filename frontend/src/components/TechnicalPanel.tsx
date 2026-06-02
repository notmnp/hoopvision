import * as React from "react"
import { BlockMath } from "react-katex"
import type { TechnicalContent } from "@/types/howItWorks"
import { Kicker } from "@/components/editorial"

/**
 * SafeBlockMath — renders a single LaTeX equation, falling back to the raw
 * source string if KaTeX throws on a malformed expression so the page never
 * crashes on bad input.
 */
class SafeBlockMath extends React.Component<
  { math: string },
  { hasError: boolean }
> {
  constructor(props: { math: string }) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  render() {
    if (this.state.hasError) {
      return (
        <pre className="overflow-x-auto rounded-sm border border-destructive/30 bg-destructive/5 p-3 font-mono text-sm text-muted-foreground">
          {this.props.math}
        </pre>
      )
    }
    return <BlockMath math={this.props.math} />
  }
}

/**
 * TechnicalPanel — the technical deep-dive layer for a section. Renders only
 * the sub-elements present in the TechnicalContent object: equations,
 * pseudocode, data tables, and supplementary prose.
 */
export function TechnicalPanel({ technical }: { technical: TechnicalContent }) {
  const { equations, pseudocode, tables, prose } = technical
  const hasContent =
    (equations && equations.length > 0) ||
    !!pseudocode ||
    (tables && tables.length > 0) ||
    !!prose

  if (!hasContent) return null

  return (
    <div className="mt-6 flex flex-col gap-5 rounded-sm border border-foreground/15 bg-newsprint p-5 sm:p-6">
      <Kicker ruled tone="muted">
        Under the Hood
      </Kicker>
      {equations && equations.length > 0 && (
        <div className="flex flex-col gap-3 overflow-x-auto">
          {equations.map((eq, i) => (
            <SafeBlockMath key={i} math={eq} />
          ))}
        </div>
      )}

      {pseudocode && (
        <pre className="overflow-x-auto rounded-sm border border-foreground/15 bg-background p-4 font-mono text-[0.82rem] leading-relaxed text-foreground/90">
          {pseudocode}
        </pre>
      )}

      {tables && tables.length > 0 && (
        <div className="flex flex-col gap-5">
          {tables.map((table, ti) => (
            <div key={ti} className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b-2 border-foreground/70 text-left">
                    {table.headers.map((header, hi) => (
                      <th
                        key={hi}
                        className="px-3 py-2 font-display font-semibold text-foreground"
                      >
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((row, ri) => (
                    <tr key={ri} className="border-b border-border">
                      {row.map((cell, ci) => (
                        <td
                          key={ci}
                          className="px-3 py-2 align-top text-foreground/80 tabular-nums"
                        >
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {prose && (
        <p className="text-sm leading-relaxed text-muted-foreground">
          {prose}
        </p>
      )}
    </div>
  )
}

export default TechnicalPanel
