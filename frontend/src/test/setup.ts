import { afterEach } from "vitest"
import { cleanup } from "@testing-library/react"

// jsdom has no matchMedia; useMediaQuery needs it. Default to "no match" so the
// draft renders its desktop layout (placement via the board, not a bottom sheet).
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList
}

afterEach(() => cleanup())
