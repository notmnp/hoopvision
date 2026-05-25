import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import axios from "axios"
import { Command as CommandPrimitive } from "cmdk"
import {
  AlertTriangle,
  CalendarDays,
  Loader2,
  Search,
  Sparkles,
  Swords,
  Trophy,
  UserRound,
} from "lucide-react"

import { API_BASE_URL } from "@/lib/config"
import {
  BRACKET_SIZES,
  BracketConfig,
  BracketSize,
  BracketState,
  SERIES_FORMATS,
  SeriesFormat,
  headshotUrl,
} from "@/lib/bracket"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import {
  PlayerProfile,
  PlayerSuggestion,
  usePlayerSearch,
  usePlayerSuggestions,
} from "@/hooks/usePlayerSearch"
import { usePlayerSeasons } from "@/hooks/usePlayerSeasons"

// One participant slot's resolved selection. A slot is "ready" once it has both
// a player and a season; the bracket can only be submitted when every slot is.
interface BracketSlot {
  player_id: number | null
  name: string | null
  season_id: string | null
}

const EMPTY_SLOT: BracketSlot = {
  player_id: null,
  name: null,
  season_id: null,
}

function emptySlots(size: number): BracketSlot[] {
  return Array.from({ length: size }, () => ({ ...EMPTY_SLOT }))
}

function isSlotReady(slot: BracketSlot): boolean {
  return slot.player_id !== null && slot.season_id !== null
}

export default function BracketSetupController() {
  const navigate = useNavigate()
  const [size, setSize] = useState<BracketSize>(8)
  const [seriesFormat, setSeriesFormat] = useState<SeriesFormat>(7)
  const [slots, setSlots] = useState<BracketSlot[]>(() => emptySlots(8))
  const [loadingDefault, setLoadingDefault] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function changeSize(nextSize: BracketSize) {
    setSize(nextSize)
    setSlots(emptySlots(nextSize))
    setError(null)
  }

  function updateSlot(index: number, slot: BracketSlot) {
    setSlots((current) => {
      const next = [...current]
      next[index] = slot
      return next
    })
  }

  async function loadPreconfigured() {
    setLoadingDefault(true)
    setError(null)
    try {
      const response = await axios.get<BracketConfig>(
        `${API_BASE_URL}/bracket/default/${size}`
      )
      // The default config carries player_id + season_id per seed; names are
      // resolved lazily by each slot from the headshot/season lookups.
      setSlots(
        response.data.participants.map((participant) => ({
          player_id: participant.player_id,
          name: null,
          season_id: participant.season_id,
        }))
      )
    } catch (caught) {
      setError(getBracketError(caught, "Failed to load the pre-configured bracket."))
    } finally {
      setLoadingDefault(false)
    }
  }

  const filledCount = slots.filter(isSlotReady).length
  const allFilled = filledCount === size
  const busy = loadingDefault || submitting

  async function simulate() {
    if (!allFilled) return
    setSubmitting(true)
    setError(null)
    try {
      // Seeds are positional (ADR-003): slot index 0 is seed 1.
      const config: BracketConfig = {
        bracket_size: size,
        series_format: seriesFormat,
        participants: slots.map((slot, index) => ({
          player_id: slot.player_id as number,
          season_id: slot.season_id as string,
          seed: index + 1,
        })),
      }
      const response = await axios.post<{ bracket_id: string; bracket_state: BracketState }>(
        `${API_BASE_URL}/bracket`,
        config
      )
      navigate(`/bracket/${response.data.bracket_id}`)
    } catch (caught) {
      setError(getBracketError(caught, "Failed to create the bracket."))
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-screen-xl flex-col px-4 py-8 md:px-6">
      <div className="mb-6 flex flex-col gap-4 border-b pb-6 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <div className="text-sm font-medium text-muted-foreground">
            GOAT Bracket
          </div>
          <h1 className="text-3xl font-bold tracking-tight">
            Build your tournament
          </h1>
          <p className="text-sm text-muted-foreground">
            Pick the field, then run every matchup as a best-of series through
            the IsoLab engine until one champion remains.
          </p>
        </div>
        <div className="flex flex-col items-stretch gap-3 sm:items-end">
          <div className="flex flex-wrap items-end gap-4">
            <SegmentedControl
              label="Bracket size"
              options={BRACKET_SIZES.map((value) => ({
                value,
                label: `${value}`,
              }))}
              value={size}
              onChange={(value) => changeSize(value as BracketSize)}
              disabled={busy}
            />
            <SegmentedControl
              label="Series format"
              options={SERIES_FORMATS.map((value) => ({
                value,
                label: `Bo${value}`,
              }))}
              value={seriesFormat}
              onChange={(value) => setSeriesFormat(value as SeriesFormat)}
              disabled={busy}
            />
          </div>
          <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-end">
            <Button
              variant="secondary"
              onClick={loadPreconfigured}
              disabled={busy}
              className="sm:w-auto"
            >
              {loadingDefault ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Load Pre-configured Bracket
            </Button>
            <Button
              onClick={simulate}
              disabled={!allFilled || busy}
              className="sm:w-auto"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Swords className="h-4 w-4" />
              )}
              Simulate
            </Button>
          </div>
        </div>
      </div>

      <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Trophy className="h-4 w-4" />
        {filledCount} of {size} seeds set
      </div>

      {error && (
        <Alert variant="destructive" className="mb-5">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Couldn't continue</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {slots.map((slot, index) => (
          <ParticipantSlot
            key={index}
            seed={index + 1}
            slot={slot}
            onChange={(next) => updateSlot(index, next)}
            disabled={busy}
          />
        ))}
      </div>
    </div>
  )
}

function SegmentedControl({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string
  options: { value: number; label: string }[]
  value: number
  onChange: (value: number) => void
  disabled?: boolean
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <div className="inline-flex rounded-md border bg-muted/40 p-0.5">
        {options.map((option) => {
          const active = option.value === value
          return (
            <button
              key={option.value}
              type="button"
              disabled={disabled}
              aria-pressed={active}
              onClick={() => onChange(option.value)}
              className={cn(
                "min-w-[3rem] rounded-[5px] px-3 py-1.5 text-sm font-medium transition-colors",
                "disabled:cursor-not-allowed disabled:opacity-50",
                active
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ParticipantSlot({
  seed,
  slot,
  onChange,
  disabled,
}: {
  seed: number
  slot: BracketSlot
  onChange: (slot: BracketSlot) => void
  disabled?: boolean
}) {
  const [query, setQuery] = useState("")
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const searchContainerRef = useRef<HTMLDivElement>(null)
  const { searchPlayer, loading: searchLoading } = usePlayerSearch()
  const {
    suggestions,
    loading: suggestionsLoading,
    searchSuggestions,
    clearSuggestions,
  } = usePlayerSuggestions()
  const { seasons, loading: seasonsLoading, loadSeasons } = usePlayerSeasons()
  const loadedForPlayer = useRef<number | null>(null)

  // Whenever a player is set (via search or a loaded default), make sure that
  // player's season list is available so the season selector is populated.
  useEffect(() => {
    if (slot.player_id !== null && loadedForPlayer.current !== slot.player_id) {
      loadedForPlayer.current = slot.player_id
      loadSeasons(slot.player_id)
    }
    if (slot.player_id === null) {
      loadedForPlayer.current = null
    }
  }, [slot.player_id, loadSeasons])

  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      clearSuggestions()
      return
    }
    const handle = setTimeout(() => searchSuggestions(trimmed), 300)
    return () => clearTimeout(handle)
  }, [query, searchSuggestions, clearSuggestions])

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(event.target as Node)
      ) {
        setSuggestionsOpen(false)
      }
    }
    document.addEventListener("mousedown", handlePointerDown)
    return () => document.removeEventListener("mousedown", handlePointerDown)
  }, [])

  async function confirmPlayer(profile: PlayerProfile) {
    const loaded = await loadSeasons(profile.player_id)
    loadedForPlayer.current = profile.player_id
    const mostRecent = loaded?.[0]?.season_id ?? null
    onChange({
      player_id: profile.player_id,
      name: profile.name,
      season_id: mostRecent,
    })
  }

  async function handleSelectSuggestion(suggestion: PlayerSuggestion) {
    setSuggestionsOpen(false)
    setQuery("")
    clearSuggestions()
    const profile = await searchPlayer(suggestion.full_name)
    if (profile) {
      await confirmPlayer(profile)
    }
  }

  function clearSlot() {
    onChange({ ...EMPTY_SLOT })
    setQuery("")
    clearSuggestions()
  }

  const filled = slot.player_id !== null

  return (
    <div className="flex min-h-[11rem] flex-col overflow-hidden rounded-lg border bg-card shadow-sm">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Badge variant="secondary" className="h-5 px-1.5 tabular-nums">
            {seed}
          </Badge>
          Seed {seed}
        </span>
        {filled && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs text-muted-foreground"
            onClick={clearSlot}
            disabled={disabled}
          >
            Clear
          </Button>
        )}
      </div>

      {filled ? (
        <div className="flex flex-1 flex-col gap-3 p-3">
          <div className="flex items-center gap-3">
            <Avatar className="h-12 w-12 shrink-0 rounded-md border bg-muted">
              <AvatarImage
                src={headshotUrl(slot.player_id as number)}
                alt={slot.name ?? `Seed ${seed}`}
                className="object-cover object-top"
              />
              <AvatarFallback className="rounded-md text-xs font-semibold">
                {slot.name ? getInitials(slot.name) : seed}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">
                {slot.name ?? `Player #${slot.player_id}`}
              </div>
              <div className="text-xs text-muted-foreground">
                {slot.season_id ? `${slot.season_id} season` : "Select a season"}
              </div>
            </div>
          </div>

          <Select
            value={slot.season_id ?? undefined}
            onValueChange={(value) => onChange({ ...slot, season_id: value })}
            disabled={disabled || seasonsLoading || seasons.length === 0}
          >
            <SelectTrigger
              aria-label={`Select season for seed ${seed}`}
              className="h-8 gap-1.5 text-xs"
            >
              <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
              <SelectValue
                placeholder={seasonsLoading ? "Loading seasons…" : "Select a season"}
              />
            </SelectTrigger>
            <SelectContent position="popper" className="max-h-64">
              {seasons.map((season) => (
                <SelectItem key={season.season_id} value={season.season_id}>
                  {season.season_label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : (
        <div className="flex flex-1 flex-col p-3">
          <div ref={searchContainerRef} className="relative">
            <CommandPrimitive shouldFilter={false} className="overflow-visible bg-transparent">
              <div className="flex h-9 items-center gap-2 rounded-md border bg-background px-3 shadow-sm focus-within:ring-1 focus-within:ring-ring">
                <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                <CommandPrimitive.Input
                  value={query}
                  disabled={disabled}
                  onValueChange={(value) => {
                    setQuery(value)
                    setSuggestionsOpen(value.trim() !== "")
                  }}
                  onFocus={() => {
                    if (query.trim() !== "") setSuggestionsOpen(true)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setSuggestionsOpen(false)
                  }}
                  placeholder={`Search seed ${seed}…`}
                  aria-label={`Search for seed ${seed}`}
                  className="flex h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
                />
                {(searchLoading || suggestionsLoading) && (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                )}
              </div>

              {suggestionsOpen && query.trim() !== "" && (
                <CommandList className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
                  {suggestionsLoading && suggestions.length === 0 ? (
                    <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Searching…
                    </div>
                  ) : suggestions.length === 0 ? (
                    <CommandEmpty>No players found.</CommandEmpty>
                  ) : (
                    <CommandGroup className="p-0">
                      {suggestions.map((suggestion) => (
                        <CommandItem
                          key={suggestion.id}
                          value={`${suggestion.full_name}__${suggestion.id}`}
                          onSelect={() => handleSelectSuggestion(suggestion)}
                        >
                          {suggestion.full_name}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}
                </CommandList>
              )}
            </CommandPrimitive>
          </div>

          <div className="mt-3 flex flex-1 flex-col items-center justify-center gap-1 rounded-md border border-dashed text-xs text-muted-foreground">
            <UserRound className="h-6 w-6 opacity-40" />
            Empty slot
          </div>
        </div>
      )}
    </div>
  )
}

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
}

function getBracketError(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail
    if (typeof detail === "string") return detail
    if (!error.response) return "Backend is unavailable."
  }
  return fallback
}
