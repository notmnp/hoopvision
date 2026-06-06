// DraftExporter — captures the DraftResultCard as a downloadable PNG share card,
// composited onto a padded canvas with a printed Hooper masthead so the shared
// image reads like an almanac "draft results" page (the same branded-poster
// treatment as the GOAT Bracket export).
//
// ADR-004: html2canvas runs client-side (no server image service). The library
// is lazy-loaded via dynamic import on the share trigger so it stays out of the
// initial bundle. Headshots are served through the API's /headshot proxy and
// rendered crossOrigin="anonymous", so useCORS lets html2canvas read their
// pixels without tainting the canvas. We use html2canvas-pro because the
// Tailwind v4 theme defines colors with oklch(), which the original html2canvas
// can't parse.

// Padding (CSS px, pre-scale) framing the card in the exported image.
const EXPORT_PADDING = 40
// Height reserved for the top-left Hooper masthead (wordmark + page title).
const BRAND_HEIGHT = 46
// Gap between the masthead band and the card below it.
const BRAND_GAP = 24

export async function exportDraftCard(
  node: HTMLElement | null,
  record: { wins: number; losses: number }
): Promise<void> {
  if (!node) return

  await ensureBrandFontsLoaded()

  const { default: html2canvas } = await import("html2canvas-pro")

  const scale = window.devicePixelRatio > 1 ? 2 : 1
  const background = getComputedBackgroundColor(node)

  const cardCanvas = await html2canvas(node, {
    useCORS: true,
    backgroundColor: background,
    scale,
    // Flatten resolved styles onto the clone and kill entrance animations so the
    // PNG matches the page. Reasons:
    //  - The theme's translucent oklch/color-mix tints (card, muted track,
    //    foreground/40 bar fill, team-colored left borders) render unreliably
    //    unless we copy the already-resolved rgba() that getComputedStyle gives.
    //  - The halftone dot fields paint via `background-image:
    //    radial-gradient(var(--halftone-color)…)`; copying the *computed*
    //    backgroundImage hands html2canvas a literal gradient with the var()
    //    already substituted, so the texture survives the capture.
    //  - The champion "splash" relies on a CSS `mask-image` to fade into a
    //    corner. html2canvas can't apply masks, so an unmasked clone would paint
    //    the dot field across the whole panel. We drop the mask AND the
    //    background-image together for masked nodes so the capture matches the
    //    on-screen framing rather than smearing dots edge-to-edge.
    //  - A freshly-cloned `animate-in` element would otherwise capture frozen at
    //    its t=0 (opacity:0) keyframe.
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

        const hasMask =
          (computed.maskImage && computed.maskImage !== "none") ||
          (computed.webkitMaskImage && computed.webkitMaskImage !== "none")
        if (hasMask) {
          // html2canvas ignores masks; without the source image too, a masked
          // halftone splash would otherwise tile across the entire panel.
          clone.style.backgroundImage = "none"
          clone.style.maskImage = "none"
          clone.style.webkitMaskImage = "none"
        } else if (computed.backgroundImage && computed.backgroundImage !== "none") {
          clone.style.backgroundImage = computed.backgroundImage
        }
      }
    },
  })

  // Composite onto a padded canvas with a masthead band in the top-left.
  const pad = EXPORT_PADDING * scale
  const brandH = BRAND_HEIGHT * scale
  const gap = BRAND_GAP * scale

  const output = document.createElement("canvas")
  output.width = cardCanvas.width + pad * 2
  output.height = cardCanvas.height + pad * 2 + brandH + gap

  const ctx = output.getContext("2d")
  if (!ctx) {
    triggerDownload(cardCanvas.toDataURL("image/png"), exportFilename(record))
    return
  }

  ctx.fillStyle = background
  ctx.fillRect(0, 0, output.width, output.height)

  await drawBranding(ctx, pad, pad, brandH, scale)
  ctx.drawImage(cardCanvas, pad, pad + brandH + gap)

  triggerDownload(output.toDataURL("image/png"), exportFilename(record))
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

// Logo + "Hooper" wordmark (Fraunces) + "ALL-TIME DRAFT" page title (tracked
// Archivo), anchored at (x, y) within a band of the given height — matching the
// bracket poster's branding so shared draft images share the same masthead.
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

  ctx.font = `900 ${23 * scale}px Fraunces, Georgia, "Times New Roman", serif`
  ctx.fillText("Hooper", textX, y + 20 * scale)

  ctx.globalAlpha = 0.65
  const spacedCtx = ctx as CanvasRenderingContext2D & { letterSpacing?: string }
  const prevSpacing = spacedCtx.letterSpacing
  spacedCtx.letterSpacing = `${1.6 * scale}px`
  ctx.font = `700 ${12 * scale}px Archivo, "Helvetica Neue", system-ui, sans-serif`
  ctx.fillText("ALL-TIME DRAFT", textX, y + 39 * scale)
  if (prevSpacing !== undefined) spacedCtx.letterSpacing = prevSpacing
  ctx.globalAlpha = 1
}

async function ensureBrandFontsLoaded(): Promise<void> {
  if (!("fonts" in document)) return
  try {
    await Promise.all([
      document.fonts.load('900 23px "Fraunces"'),
      document.fonts.load('800 48px "Fraunces"'),
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
