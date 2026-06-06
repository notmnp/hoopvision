// DraftExporter — captures the DraftResultCard as a downloadable PNG share card.
//
// ADR-004: html2canvas runs client-side (no server image service). The library
// is lazy-loaded via dynamic import on the share trigger so it stays out of the
// initial bundle. Headshots are served through the API's /headshot proxy and
// rendered crossOrigin="anonymous", so useCORS lets html2canvas read their
// pixels without tainting the canvas. We use the html2canvas-pro fork because
// the Tailwind v4 theme defines colors with oklch(), which the original
// html2canvas can't parse — the same reason GOAT Bracket's exporter uses it.

export async function exportDraftCard(
  node: HTMLElement | null,
  record: { wins: number; losses: number }
): Promise<void> {
  if (!node) return

  // Ensure the editorial web fonts are loaded so the capture doesn't fall back
  // to a system serif/sans mid-render.
  await ensureBrandFontsLoaded()

  const { default: html2canvas } = await import("html2canvas-pro")

  const scale = window.devicePixelRatio > 1 ? 2 : 1
  const background = getComputedBackgroundColor(node)

  const canvas = await html2canvas(node, {
    useCORS: true,
    backgroundColor: background,
    scale,
    // Flatten every element's resolved color onto the clone and kill entrance
    // animations: the theme's translucent oklch/color-mix tints render
    // unreliably otherwise, and a freshly-cloned `animate-in` element would be
    // captured at its t=0 (invisible) keyframe.
    onclone: (_doc, cloned) => {
      const originals = [node, ...node.querySelectorAll<HTMLElement>("*")]
      const clones = [
        cloned as HTMLElement,
        ...cloned.querySelectorAll<HTMLElement>("*"),
      ]
      const count = Math.min(originals.length, clones.length)
      for (let i = 0; i < count; i++) {
        const computed = window.getComputedStyle(originals[i])
        const clone = clones[i]
        clone.style.backgroundColor = computed.backgroundColor
        clone.style.color = computed.color
        clone.style.borderColor = computed.borderColor
        clone.style.animation = "none"
      }
    },
  })

  triggerDownload(canvas.toDataURL("image/png"), exportFilename(record))
}

export function exportFilename({
  wins,
  losses,
}: {
  wins: number
  losses: number
}): string {
  return `all-time-draft-${wins}-${losses}.png`
}

async function ensureBrandFontsLoaded(): Promise<void> {
  if (!("fonts" in document)) return
  try {
    await Promise.all([
      document.fonts.load('800 24px "Fraunces"'),
      document.fonts.load('900 48px "Fraunces"'),
      document.fonts.load('700 12px "Archivo"'),
      document.fonts.load('400 14px "Archivo"'),
    ])
    await document.fonts.ready
  } catch {
    // Fall back to system fonts rather than failing the export.
  }
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
// resolved background so the PNG matches the on-screen theme.
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
