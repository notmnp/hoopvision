// BracketExporter — captures the rendered bracket tree as a downloadable PNG.
//
// ADR-006: html2canvas runs client-side, so no server image-generation
// infrastructure is needed. The library is loaded lazily via dynamic import on
// the export trigger to keep it out of the initial bundle. Headshots are
// rendered with crossOrigin="anonymous" (in BracketView) so html2canvas can read
// the NBA CDN pixels without tainting the canvas.

export interface BracketExportOptions {
  size: number
  seriesFormat: number
}

export async function exportBracketImage(
  node: HTMLElement | null,
  options: BracketExportOptions
): Promise<void> {
  if (!node) return

  const { default: html2canvas } = await import("html2canvas")

  const canvas = await html2canvas(node, {
    // useCORS lets the NBA CDN headshots (served with permissive CORS and
    // requested crossOrigin) be drawn into the canvas without tainting it.
    useCORS: true,
    backgroundColor: getComputedBackgroundColor(node),
    scale: window.devicePixelRatio > 1 ? 2 : 1,
  })

  const dataUrl = canvas.toDataURL("image/png")
  triggerDownload(dataUrl, exportFilename(options))
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
