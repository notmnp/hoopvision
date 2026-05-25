import { useParams } from "react-router-dom"
import { Loader2 } from "lucide-react"

// Placeholder shell. Full bracket-tree rendering, round progression, series
// drill-down, and export are implemented in WO-32 / WO-33; for now this confirms
// the bracket was created and the route resolves with its bracket_id.
export default function BracketView() {
  const { bracketId } = useParams<{ bracketId: string }>()
  return (
    <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-screen-xl flex-col items-center justify-center gap-3 px-4 py-8 text-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      <p className="text-sm text-muted-foreground">
        Bracket <span className="font-mono">{bracketId}</span> created.
      </p>
    </div>
  )
}
