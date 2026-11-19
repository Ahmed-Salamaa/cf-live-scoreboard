import { useCallback, useEffect, useRef, useState } from 'react'
import { normalize } from './engine/codeforces'
import { makeDemo } from './engine/demo'
import { initReveal, pickNext, resolveCurrent, revealAll, type RevealState } from './engine/reveal'
import type { ContestData } from './engine/types'

const POLL_MS = 15000

export function useContestData(pollingEnabled: boolean) {
  const [data, setData] = useState<ContestData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const enabledRef = useRef(pollingEnabled)
  enabledRef.current = pollingEnabled

  const load = useCallback(async (fromPoll = false) => {
    try {
      if (new URLSearchParams(location.search).has('demo')) {
        setData((d) => d ?? makeDemo())
        setError(null)
        return
      }
      const res = await fetch('/api/contest')
      const json = await res.json()
      if (fromPoll && !enabledRef.current) return
      if (json.ok) {
        setData(normalize(json))
        setError(json.error ? `Showing saved data (${json.error})` : null)
      } else if (json.demo) {
        setData((d) => d ?? makeDemo())
        setError(null)
      } else setError(json.error || 'Failed to load contest')
    } catch (e) {
      if (!fromPoll || enabledRef.current) setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load(false)
  }, [load])

  const live = data && data.source !== 'demo' && data.contest.phase !== 'FINISHED'
  useEffect(() => {
    if (!pollingEnabled || !live) return
    const t = setInterval(() => load(true), POLL_MS)
    return () => clearInterval(t)
  }, [pollingEnabled, live, load])

  const reload = useCallback(() => load(false), [load])
  return { data, error, loading, reload }
}

/** Estimated seconds since contest start; Infinity once the contest is finished. */
export function useNowSec(data: ContestData | null): number {
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])
  if (!data) return -Infinity
  const c = data.contest
  if (c.phase === 'FINISHED' || data.source === 'demo') return Infinity
  if (c.relativeSec == null) return Infinity
  return c.relativeSec + (Date.now() - data.fetchedAt) / 1000
}

export function useReveal(data: ContestData | null, freezeAt: number, speed: number, moveMs: number) {
  const [st, setSt] = useState<RevealState | null>(null)
  const [running, setRunning] = useState(false)
  const dataRef = useRef(data)
  dataRef.current = data

  const start = useCallback(() => {
    if (!dataRef.current) return
    setSt(initReveal(dataRef.current, freezeAt))
    setRunning(true)
  }, [freezeAt])
  const restart = useCallback(() => {
    if (!dataRef.current) return
    setSt(initReveal(dataRef.current, freezeAt))
    setRunning(false)
  }, [freezeAt])
  const exit = useCallback(() => {
    setSt(null)
    setRunning(false)
  }, [])
  const stepOnce = useCallback(() => {
    setSt((s) => (s && s.phase === 'idle' && dataRef.current ? pickNext(dataRef.current, s) : s))
  }, [])
  const skip = useCallback(() => {
    setRunning(false)
    setSt((s) => (s && dataRef.current ? revealAll(dataRef.current, s) : s))
  }, [])

  useEffect(() => {
    if (!st || !data) return
    const k = 1 / speed
    if (st.phase === 'pending') {
      const ms = (st.curNoEffect ? 260 : 1100) * k
      const t = setTimeout(() => setSt((s) => (s && s.phase === 'pending' ? resolveCurrent(data, s) : s)), ms)
      return () => clearTimeout(t)
    }
    if (st.phase === 'idle' && running) {
      const moved = st.move && st.move.from !== st.move.to
      let ms = 800 * k
      if (st.move) ms = st.move.noEffect ? 160 * k : moved ? Math.max(1300 * k, moveMs + 120) : 700 * k
      const t = setTimeout(() => setSt((s) => (s && s.phase === 'idle' ? pickNext(data, s) : s)), ms)
      return () => clearTimeout(t)
    }
    if (st.phase === 'finished' && running) setRunning(false)
  }, [st, running, speed, data, moveMs])

  return { st, running, setRunning, start, restart, exit, stepOnce, skip }
}
