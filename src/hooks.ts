import { useCallback, useEffect, useRef, useState } from 'react'
import { normalize } from './engine/codeforces'
import { makeDemo } from './engine/demo'
import { initReveal, pickNext, resolveCurrent, revealAll, type RevealState } from './engine/reveal'
import type { ContestData } from './engine/types'

const POLL_MS = 15000

export interface ContestDataOptions {
  isAdmin?: boolean
  enabled?: boolean
  onUnauthorized?: () => void
}

export function useContestData(pollingEnabled: boolean, opts: ContestDataOptions = {}) {
  const { isAdmin = false, enabled = true, onUnauthorized } = opts
  const [data, setData] = useState<ContestData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(enabled)
  const enabledRef = useRef(pollingEnabled)
  enabledRef.current = pollingEnabled
  const onUnauthRef = useRef(onUnauthorized)
  onUnauthRef.current = onUnauthorized

  const load = useCallback(
    async (fromPoll = false) => {
      if (!enabled) return
      try {
        if (new URLSearchParams(location.search).has('demo')) {
          setData((d) => d ?? makeDemo())
          setError(null)
          return
        }
        const endpoint = isAdmin ? '/api/contest?admin=1' : '/api/contest'
        const res = await fetch(endpoint, { credentials: 'same-origin' })
        if (res.status === 401) {
          onUnauthRef.current?.()
          return
        }
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
    },
    [enabled, isAdmin],
  )

  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      return
    }
    setLoading(true)
    load(false)
  }, [enabled, load])

  const live = data && data.source !== 'demo' && data.contest.phase !== 'FINISHED'
  useEffect(() => {
    if (!enabled || !pollingEnabled || !live) return
    const t = setInterval(() => load(true), POLL_MS)
    return () => clearInterval(t)
  }, [enabled, pollingEnabled, live, load])

  const reload = useCallback(() => load(false), [load])
  return { data, error, loading, reload }
}

export function useAdminSession(active: boolean) {
  const [checking, setChecking] = useState(active)
  const [authenticated, setAuthenticated] = useState(false)
  const [configured, setConfigured] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!active) {
      setChecking(false)
      return
    }
    let cancelled = false
    setChecking(true)
    fetch('/api/admin/session', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return
        setAuthenticated(Boolean(j.authenticated))
        setConfigured(j.configured !== false)
      })
      .catch(() => {
        if (!cancelled) setAuthError('Could not verify admin session.')
      })
      .finally(() => {
        if (!cancelled) setChecking(false)
      })
    return () => {
      cancelled = true
    }
  }, [active])

  const login = useCallback(async (password: string) => {
    setSubmitting(true)
    setAuthError(null)
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ password }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.ok && json.ok) {
        setAuthenticated(true)
        return true
      }
      setAuthError(json.error || 'Login failed.')
      return false
    } catch (e) {
      setAuthError(String(e))
      return false
    } finally {
      setSubmitting(false)
    }
  }, [])

  const logout = useCallback(async () => {
    try {
      await fetch('/api/admin/logout', { method: 'POST', credentials: 'same-origin' })
    } finally {
      setAuthenticated(false)
    }
  }, [])

  const expire = useCallback(() => {
    setAuthenticated(false)
    setAuthError('Your admin session expired. Please sign in again.')
  }, [])

  return { checking, authenticated, configured, authError, submitting, login, logout, expire }
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
