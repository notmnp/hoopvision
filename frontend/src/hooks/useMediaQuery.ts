import { useEffect, useState } from "react"

/**
 * Subscribe to a CSS media query and re-render when it flips. SSR-safe (returns
 * false until mounted). Used to swap touch-first affordances in on small
 * screens — e.g. the draft's bottom-sheet placement below the `lg` breakpoint.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false)

  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    onChange()
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [query])

  return matches
}
