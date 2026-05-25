// BracketExporter — captures the rendered bracket tree as a PNG (WO-33).
//
// Placeholder pending WO-33: the full html2canvas-based capture (lazy dynamic
// import, crossOrigin headshot handling, filename convention) is implemented
// there. BracketView already wires its "Export Bracket" action and bracket-tree
// ref to this function so the integration point is stable.

export interface BracketExportOptions {
  size: number
  seriesFormat: number
}

export async function exportBracketImage(
  node: HTMLElement | null,
  options: BracketExportOptions
): Promise<void> {
  // Implemented in WO-33; the args are referenced here so the public signature
  // BracketView depends on stays stable until then.
  void node
  void options
}
