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

  const { default: html2canvas } = await import("html2canvas-pro")

  const scale = window.devicePixelRatio > 1 ? 2 : 1
  const background = getComputedBackgroundColor(node)

  const bracketCanvas = await html2canvas(node, {
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
      const originals = [node, ...node.querySelectorAll<HTMLElement>("*")]
      const clones = [
        clonedRoot as HTMLElement,
        ...clonedRoot.querySelectorAll<HTMLElement>("*"),
      ]
      const count = Math.min(originals.length, clones.length)
      for (let i = 0; i < count; i++) {
        const computed = window.getComputedStyle(originals[i])
        clones[i].style.backgroundColor = computed.backgroundColor
        clones[i].style.color = computed.color
        clones[i].style.borderColor = computed.borderColor
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

  // Wordmark on top, the page title beneath it (dimmed to read as a subtitle).
  ctx.font = `700 ${21 * scale}px Inter, system-ui, -apple-system, sans-serif`
  ctx.fillText("Hooper", textX, y + 19 * scale)

  ctx.globalAlpha = 0.6
  ctx.font = `500 ${15 * scale}px Inter, system-ui, -apple-system, sans-serif`
  ctx.fillText("GOAT Brackets", textX, y + 40 * scale)
  ctx.globalAlpha = 1
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
