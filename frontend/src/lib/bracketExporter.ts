// BracketExporter — captures the rendered bracket tree as a downloadable PNG.
//
// ADR-006: html2canvas runs client-side, so no server image-generation
// infrastructure is needed. The library is loaded lazily via dynamic import on
// the export trigger to keep it out of the initial bundle. Headshots are served
// through the API's /headshot proxy (cdn.nba.com sends no CORS headers) and
// rendered with crossOrigin="anonymous", so html2canvas can read their pixels
// without tainting the canvas.
//
// We use the html2canvas-pro fork rather than html2canvas: the app's Tailwind v4
// theme defines every color token with oklch(), which the original html2canvas
// (v1.x) parser can't read — it throws "unsupported color function 'oklch'" and
// aborts the capture. The pro fork parses oklch()/lab()/color-mix() natively.

export interface BracketExportOptions {
  size: number
  seriesFormat: number
}

// Padding (in CSS px, before scaling) framing the bracket in the exported image.
const EXPORT_PADDING = 40
// Height reserved for the top-left HoopVision branding header (fits two lines:
// the wordmark and the "GOAT Brackets" page title beneath it).
const BRAND_HEIGHT = 46
// Gap between the branding header and the bracket below it.
const BRAND_GAP = 24

export async function exportBracketImage(
  node: HTMLElement | null,
  options: BracketExportOptions
): Promise<void> {
  if (!node) return

  // Make sure the design's web fonts (Fraunces display + Archivo sans) are
  // actually loaded before we rasterize — otherwise html2canvas captures the
  // tree in a fallback serif/sans and the canvas branding below falls back too.
  await ensureBrandFontsLoaded()

  const { default: html2canvas } = await import("html2canvas-pro")

  const scale = window.devicePixelRatio > 1 ? 2 : 1
  const background = getComputedBackgroundColor(node)

  // `node` is the horizontally-scrolling wrapper; capture the full-width tree
  // inside it so a wide (16-team) bracket isn't clipped to the visible viewport.
  const target = (node.firstElementChild as HTMLElement | null) ?? node

  const bracketCanvas = await html2canvas(target, {
    // useCORS lets the proxied headshots (served with CORS headers and requested
    // crossOrigin) be drawn into the canvas without tainting it.
    useCORS: true,
    backgroundColor: background,
    scale,
    // Flatten every element's color to its resolved rgba() before capture. The
    // theme's translucent tints (e.g. the `bg-emerald-500/10` behind a series
    // winner) compile to nested color-mix(oklch …) values that html2canvas
    // renders unreliably; getComputedStyle on the live node returns the already
    // mixed rgba, so copying it onto the clone guarantees those greens show up.
    onclone: (_doc, clonedRoot) => {
      const originals = [target, ...target.querySelectorAll<HTMLElement>("*")]
      const clones = [
        clonedRoot as HTMLElement,
        ...clonedRoot.querySelectorAll<HTMLElement>("*"),
      ]
      const count = Math.min(originals.length, clones.length)
      for (let i = 0; i < count; i++) {
        const computed = window.getComputedStyle(originals[i])
        const clone = clones[i]
        clone.style.backgroundColor = computed.backgroundColor
        clone.style.color = computed.color
        clone.style.borderColor = computed.borderColor
        // Kill entrance animations in the clone. The matchup cards use
        // `animate-in fade-in` with `animation-fill-mode: both`, so in the
        // freshly-cloned document the animation is at t=0 — frozen at its
        // initial opacity:0 / translated keyframe — and the capture would grab
        // every card invisible. Disabling the animation lets each element fall
        // back to its resting style (opacity 1), while genuine opacity utilities
        // (e.g. an eliminated row's opacity-40) are left untouched.
        clone.style.animation = "none"
      }
    },
  })

  // Composite the captured bracket onto a larger canvas so the export has even
  // padding and a HoopVision / GOAT Brackets header in the top-left, rather than
  // cropping tight to the rendered DOM.
  const pad = EXPORT_PADDING * scale
  const brandH = BRAND_HEIGHT * scale
  const gap = BRAND_GAP * scale

  const output = document.createElement("canvas")
  output.width = bracketCanvas.width + pad * 2
  output.height = bracketCanvas.height + pad * 2 + brandH + gap

  const ctx = output.getContext("2d")
  if (!ctx) {
    triggerDownload(bracketCanvas.toDataURL("image/png"), exportFilename(options))
    return
  }

  ctx.fillStyle = background
  ctx.fillRect(0, 0, output.width, output.height)

  await drawBranding(ctx, pad, pad, brandH, scale)
  ctx.drawImage(bracketCanvas, pad, pad + brandH + gap)

  triggerDownload(output.toDataURL("image/png"), exportFilename(options))
}

// Draws the logo, the "HoopVision" wordmark, and the "GOAT Brackets" page title
// anchored at (x, y) within a band of the given height. Picks the logo variant
// and text color to match the active (light/dark) theme so the branding reads
// against the export background.
async function drawBranding(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  height: number,
  scale: number
): Promise<void> {
  const isDark = document.documentElement.classList.contains("dark")
  const logoSrc = isDark ? "/img/logo_white.svg" : "/img/logo_black.svg"
  const textColor = window.getComputedStyle(document.body).color || "#000000"

  const logo = await loadImage(logoSrc).catch(() => null)
  let textX = x
  if (logo) {
    ctx.drawImage(logo, x, y, height, height)
    textX = x + height + 14 * scale
  }

  ctx.fillStyle = textColor
  ctx.textBaseline = "alphabetic"

  // Wordmark in the display serif (Fraunces, matching the masthead), with the
  // page title beneath it as a tracked Archivo kicker — the app's two type
  // families, so the poster reads in the same voice as the site.
  ctx.font = `900 ${23 * scale}px Fraunces, Georgia, "Times New Roman", serif`
  ctx.fillText("Hooper", textX, y + 20 * scale)

  ctx.globalAlpha = 0.65
  // letterSpacing is a recent canvas property; guard it for older engines.
  const spacedCtx = ctx as CanvasRenderingContext2D & { letterSpacing?: string }
  const prevSpacing = spacedCtx.letterSpacing
  spacedCtx.letterSpacing = `${1.6 * scale}px`
  ctx.font = `700 ${12 * scale}px Archivo, "Helvetica Neue", system-ui, sans-serif`
  ctx.fillText("GOAT BRACKETS", textX, y + 39 * scale)
  if (prevSpacing !== undefined) spacedCtx.letterSpacing = prevSpacing
  ctx.globalAlpha = 1
}

// Force the brand faces used by the capture + canvas branding to load. Best
// effort: a font failure must never block the export (it just falls back).
async function ensureBrandFontsLoaded(): Promise<void> {
  if (!("fonts" in document)) return
  try {
    await Promise.all([
      document.fonts.load('900 23px "Fraunces"'),
      document.fonts.load('800 24px "Fraunces"'),
      document.fonts.load('700 12px "Archivo"'),
      document.fonts.load('400 14px "Archivo"'),
    ])
    await document.fonts.ready
  } catch {
    // Fall back to system fonts rather than failing the export.
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

export function exportFilename({ size, seriesFormat }: BracketExportOptions): string {
  return `goat-bracket-${size}-bo${seriesFormat}.png`
}

function triggerDownload(dataUrl: string, filename: string): void {
  const link = document.createElement("a")
  link.href = dataUrl
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

// html2canvas renders transparent backgrounds as black; capture the app's
// resolved background so the exported PNG matches the on-screen theme.
function getComputedBackgroundColor(node: HTMLElement): string {
  const fromBody = window.getComputedStyle(document.body).backgroundColor
  if (fromBody && fromBody !== "rgba(0, 0, 0, 0)" && fromBody !== "transparent") {
    return fromBody
  }
  const fromNode = window.getComputedStyle(node).backgroundColor
  if (fromNode && fromNode !== "rgba(0, 0, 0, 0)" && fromNode !== "transparent") {
    return fromNode
  }
  return "#ffffff"
}
