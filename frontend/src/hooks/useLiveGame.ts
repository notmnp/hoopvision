import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { PlayByPlay } from "@/lib/simulation"
import { buildTimeline } from "@/lib/liveGame"

export type PlaybackSpeed = 1 | 2 | 4 | 8

// Game-seconds the count-up clock advances per real second at 1x. Tuned so an
// average possession (~13 game-seconds) takes ~1.5s of real time at 1x — an
// unhurried "watch the shot" pace; 2x/4x/8x speed it up from there.
const BASE_RATE = 8.5

// Drives a client-side, possession-by-possession replay of an already-computed
// game. A single requestAnimationFrame loop advances a continuous game clock;
// a possession is "revealed" once the clock crosses its start time, so the
// score, shot chart, box score and ticker all stay in lock-step with the clock.
// Pause/skip/restart/seek/speed are trivial because nothing is streamed — we own
// the whole timeline up front.
export function useLiveGame(
  plays: PlayByPlay[],
  autoPlay = true,
  initialClock = 0
) {
  const { timings, totalSeconds } = useMemo(
    () => buildTimeline(plays),
    [plays]
  )

  const startAt = Math.max(0, Math.min(initialClock, totalSeconds))
  const [clockSeconds, setClockSeconds] = useState(startAt)
  // Don't auto-play if we're resuming exactly at the final whistle.
  const [playing, setPlaying] = useState(autoPlay && startAt < totalSeconds)
  const [speed, setSpeed] = useState<PlaybackSpeed>(1)

  // Refs the rAF loop reads so it never closes over stale state.
  const clockRef = useRef(0)
  const speedRef = useRef<PlaybackSpeed>(1)
  const rafRef = useRef<number | null>(null)
  const lastTsRef = useRef<number | null>(null)
  speedRef.current = speed

  const stop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    lastTsRef.current = null
  }, [])

  const setClock = useCallback((seconds: number) => {
    clockRef.current = seconds
    setClockSeconds(seconds)
  }, [])

  // Reset to the resume point whenever a new game is loaded.
  useEffect(() => {
    const resume = Math.max(0, Math.min(initialClock, totalSeconds))
    setClock(resume)
    setPlaying(autoPlay && resume < totalSeconds)
  }, [plays, autoPlay, initialClock, totalSeconds, setClock])

  // The playback loop runs only while `playing`.
  useEffect(() => {
    if (!playing || totalSeconds <= 0) {
      stop()
      return
    }
    const loop = (now: number) => {
      if (lastTsRef.current === null) lastTsRef.current = now
      const dt = (now - lastTsRef.current) / 1000
      lastTsRef.current = now
      const next = clockRef.current + dt * BASE_RATE * speedRef.current
      if (next >= totalSeconds) {
        setClock(totalSeconds)
        setPlaying(false)
        stop()
        return
      }
      setClock(next)
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return stop
  }, [playing, totalSeconds, stop, setClock])

  const play = useCallback(() => {
    // Replaying from the final whistle restarts from the tip.
    if (clockRef.current >= totalSeconds) setClock(0)
    setPlaying(true)
  }, [totalSeconds, setClock])

  const pause = useCallback(() => setPlaying(false), [])

  const togglePlay = useCallback(() => {
    setPlaying((current) => {
      if (!current && clockRef.current >= totalSeconds) setClock(0)
      return !current
    })
  }, [totalSeconds, setClock])

  // Jump straight to the final whistle — reveals every possession.
  const skip = useCallback(() => {
    setClock(totalSeconds)
    setPlaying(false)
  }, [totalSeconds, setClock])

  const restart = useCallback(() => {
    setClock(0)
    setPlaying(true)
  }, [setClock])

  const seek = useCallback(
    (seconds: number) => {
      setClock(Math.max(0, Math.min(totalSeconds, seconds)))
    },
    [totalSeconds, setClock]
  )

  // How many possessions have been revealed (their start time has elapsed).
  const revealedCount = useMemo(() => {
    let count = 0
    for (const timing of timings) {
      if (timing.start <= clockSeconds + 1e-6) count++
      else break
    }
    return Math.min(count, plays.length)
  }, [timings, clockSeconds, plays.length])

  const finished = totalSeconds > 0 && clockSeconds >= totalSeconds

  return {
    clockSeconds,
    totalSeconds,
    timings,
    revealedCount,
    playing,
    speed,
    finished,
    play,
    pause,
    togglePlay,
    skip,
    restart,
    seek,
    setSpeed,
  }
}
