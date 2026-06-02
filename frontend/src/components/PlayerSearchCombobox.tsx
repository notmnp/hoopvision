import * as React from "react"
import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  PlayerProfile,
  PlayerSuggestion,
  usePlayerSearch,
  usePlayerSuggestions,
} from "@/hooks/usePlayerSearch"

const HEADSHOT = (id: number) =>
  `https://cdn.nba.com/headshots/nba/latest/1040x760/${id}.png`

// First + last initials, e.g. "Michael Jordan" → "MJ".
function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/)
  const first = parts[0]?.[0] ?? ""
  const last = parts.length > 1 ? parts[parts.length - 1][0] : ""
  return (first + last).toUpperCase()
}

interface PlayerSearchComboboxProps {
  // The clickable element shown in place of a search box. Clicking it opens the
  // combobox popover. Rendered as the popover's anchor via `asChild`.
  trigger: React.ReactNode
  // Called with the fully resolved player profile once a suggestion is picked.
  // The caller owns what happens next (loading seasons, stats, etc.).
  onSelect: (profile: PlayerProfile) => void | Promise<void>
  disabled?: boolean
  align?: "start" | "center" | "end"
  // Extra classes for the popover content (e.g. to override the default width).
  contentClassName?: string
}

// A click-to-open player picker: the trigger replaces the always-visible search
// box, and the search input lives inside the popover. Suggestions come from the
// backend (already ranked), so cmdk filtering is disabled — it just renders and
// keyboard-navigates the results. The popover portals, so it isn't clipped by
// scrolling or overflow-hidden ancestors.
export function PlayerSearchCombobox({
  trigger,
  onSelect,
  disabled,
  align = "start",
  contentClassName = "w-[var(--radix-popover-trigger-width)]",
}: PlayerSearchComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const { searchPlayer, loading: searchLoading } = usePlayerSearch()
  const {
    suggestions,
    loading: suggestionsLoading,
    searchSuggestions,
    clearSuggestions,
  } = usePlayerSuggestions()

  // Debounced type-ahead: fetch suggestions 300ms after the last keystroke.
  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      clearSuggestions()
      return
    }
    const handle = setTimeout(() => searchSuggestions(trimmed), 300)
    return () => clearTimeout(handle)
  }, [query, searchSuggestions, clearSuggestions])

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      setQuery("")
      clearSuggestions()
    }
  }

  async function handleSelect(suggestion: PlayerSuggestion) {
    handleOpenChange(false)
    const profile = await searchPlayer(suggestion.full_name)
    if (profile) {
      await onSelect(profile)
    }
  }

  const trimmed = query.trim()

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild disabled={disabled}>
        {trigger}
      </PopoverTrigger>
      <PopoverContent align={align} sideOffset={4} className={`p-0 ${contentClassName}`}>
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search player…"
          />
          <CommandList className="max-h-60 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {searchLoading || (suggestionsLoading && suggestions.length === 0) ? (
              <div className="flex items-center justify-center gap-2 py-6 font-condensed text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {searchLoading ? "Loading player…" : "Searching…"}
              </div>
            ) : !trimmed ? (
              <div className="py-6 text-center font-condensed text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
                Type a player's name to search
              </div>
            ) : suggestions.length === 0 ? (
              <div className="py-6 text-center font-condensed text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
                No players found
              </div>
            ) : (
              <CommandGroup>
                {suggestions.map((suggestion) => (
                  <CommandItem
                    key={suggestion.id}
                    value={`${suggestion.full_name}__${suggestion.id}`}
                    onSelect={() => handleSelect(suggestion)}
                    className="gap-3 data-[selected=true]:bg-primary/10 data-[selected=true]:text-primary"
                  >
                    <Avatar className="size-8 shrink-0 rounded-sm ring-1 ring-border">
                      <AvatarImage
                        src={HEADSHOT(suggestion.id)}
                        className="object-cover object-top"
                      />
                      <AvatarFallback className="rounded-sm font-condensed text-[0.6rem] font-bold uppercase">
                        {initialsOf(suggestion.full_name)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="truncate">
                      {suggestion.full_name}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
