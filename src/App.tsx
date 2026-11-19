import { useEffect, useMemo, useState } from 'react'
import { AdminLogin } from './components/AdminLogin'
import { AdminSettings } from './components/AdminSettings'
import { Controls } from './components/Controls'
import { Feed, type FeedItem } from './components/Feed'
import { Scoreboard } from './components/Scoreboard'
import { computeBoard, firstSolves, subVisual, verdictLabel, verifyAgainstOfficial } from './engine/scoring'
import { stateFn } from './engine/reveal'
import { useAdminSession, useContestData, useNowSec, useReveal } from './hooks'

const hm = (sec: number) => {
  if (!isFinite(sec)) return '—'
  const s = Math.max(0, Math.floor(sec))
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

const lsGet = (k: string) => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
const lsSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v)
  } catch {
    /* ignore */
  }
}

interface PageProps {
  mode: 'user' | 'admin'
  theme: string
  onToggleTheme(): void
  onLogout?: () => void
  onUnauthorized?: () => void
}

function ScoreboardPage({ mode, theme, onToggleTheme, onLogout, onUnauthorized }: PageProps) {
  const isAdmin = mode === 'admin'
  const [paused, setPaused] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { data, error, loading, reload } = useContestData(!paused, { isAdmin, onUnauthorized })
  const nowSec = useNowSec(data)

  const [speed, setSpeed] = useState(() => Number(lsGet('speed')) || 3)
  useEffect(() => lsSet('speed', String(speed)), [speed])
  const moveMs = Math.round(Math.max(260, 900 / Math.sqrt(speed)))
  const [follow, setFollow] = useState(() => lsGet('follow') !== 'false')
  useEffect(() => lsSet('follow', String(follow)), [follow])

  const contestId = data?.contest.id ?? 0
  const [blindOverride, setBlindOverride] = useState<number | null>(null)
  useEffect(() => {
    if (!isAdmin) {
      setBlindOverride(null)
      return
    }
    const v = lsGet(`blind-${contestId}`)
    setBlindOverride(v ? Number(v) : null)
  }, [contestId, isAdmin])
  const blindMin = (isAdmin ? blindOverride : null) ?? (data?.contest.freezeSec != null ? data.contest.freezeSec / 60 : 60)
  const freezeAt = data ? data.contest.durationSec - blindMin * 60 : Infinity

  const [showFinal, setShowFinal] = useState(false)
  const effectiveShowFinal = isAdmin && showFinal
  const frozen = !!data && !effectiveShowFinal && nowSec >= freezeAt
  const hiddenCount = useMemo(
    () => (data ? data.submissions.filter((s) => s.timeSec >= freezeAt && (!isAdmin || s.verdict !== null)).length : 0),
    [data, freezeAt, isAdmin],
  )

  const reveal = useReveal(isAdmin ? data : null, freezeAt, speed, moveMs)
  const st = isAdmin ? reveal.st : null
  useEffect(() => setPaused(st !== null), [st])

  const first = useMemo(() => (data ? firstSolves(data) : new Map<string, number>()), [data])
  const rows = useMemo(() => {
    if (!data) return []
    if (st) return computeBoard(data, stateFn(st))
    return computeBoard(data, (s) => (frozen && s.timeSec >= freezeAt ? 'hidden' : 'final'))
  }, [data, st, frozen, freezeAt])

  const teamName = useMemo(() => new Map((data?.teams ?? []).map((t) => [t.id, t.name])), [data])

  const feed: FeedItem[] = useMemo(() => {
    if (!data) return []
    if (st) {
      const items: FeedItem[] = []
      if (st.curSubId != null) {
        const s = data.submissions.find((x) => x.id === st.curSubId)
        if (s) items.push({ key: `p${s.id}`, team: teamName.get(s.teamId) ?? s.teamId, problem: s.problem, verdict: null, visual: 'pending', timeSec: s.timeSec })
      }
      for (let i = st.log.length - 1; i >= 0 && items.length < 80; i--) {
        const l = st.log[i]
        items.push({
          key: `l${l.subId}`,
          team: teamName.get(l.teamId) ?? l.teamId,
          problem: l.problem,
          verdict: l.verdict,
          visual: l.visual,
          timeSec: l.timeSec,
          extra: l.from !== l.to ? `${l.to < l.from ? '▲' : '▼'} #${l.from} → #${l.to}` : undefined,
        })
      }
      return items
    }
    const out: FeedItem[] = []
    const subs = data.submissions
    const vis = [...subs].filter((s) => !(frozen && s.timeSec >= freezeAt)).sort((a, b) => b.timeSec - a.timeSec || b.id - a.id).slice(0, 80)
    for (const s of vis) out.push({ key: `s${s.id}`, team: teamName.get(s.teamId) ?? s.teamId, problem: s.problem, verdict: s.verdict, visual: subVisual(s, 'final', first), timeSec: s.timeSec })
    return out
  }, [data, st, frozen, freezeAt, teamName, first])

  const verification = useMemo(() => (isAdmin && data && data.source !== 'demo' ? verifyAgainstOfficial(data) : null), [isAdmin, data])

  const { running: revealRunning, setRunning: setRevealRunning, stepOnce } = reveal
  // keyboard shortcuts (admin unfreeze mode only)
  useEffect(() => {
    if (!isAdmin) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      if (!st) return
      if (e.code === 'Space') {
        e.preventDefault()
        if (st.phase !== 'finished') setRevealRunning((r) => !r)
      } else if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'n') {
        if (!revealRunning) stepOnce()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isAdmin, st, revealRunning, setRevealRunning, stepOnce])

  if (loading && !data) return <div className="center">Loading contest…</div>
  if (!data)
    return (
      <div className="center">
        <p>⚠ {error ?? 'No data'}</p>
        <div>
          <button onClick={reload}>Retry</button>{' '}
          {isAdmin && (
            <button onClick={() => setSettingsOpen(true)}>⚙ Settings</button>
          )}{' '}
          <a href="?demo">Try demo data</a>
        </div>
        {isAdmin && (
          <AdminSettings
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
            onSaved={reload}
            onUnauthorized={onUnauthorized}
          />
        )}
      </div>
    )

  const phase = data.contest.phase
  const running = nowSec >= 0 && nowSec < Infinity && nowSec < data.contest.durationSec
  let startHint: string | null = null
  if (effectiveShowFinal) startHint = 'Turn off “Show final” to see the frozen standings.'
  else if (!frozen) startHint = `The scoreboard freezes at ${hm(freezeAt)} (contest time).`
  else if (hiddenCount === 0) startHint = 'No submissions were made during the frozen period.'
  else startHint = `${hiddenCount} hidden submissions${phase !== 'FINISHED' ? ' — contest is still running; this previews with manager data' : ''}.`

  let message = ''
  if (st) {
    if (st.phase === 'finished') message = '🏁 Final standings revealed.'
    else if (st.phase === 'pending' && st.curSubId != null) {
      const s = data.submissions.find((x) => x.id === st.curSubId)
      if (s) message = `Revealing ${teamName.get(s.teamId)} · problem ${s.problem} …`
    } else if (st.log.length) {
      const l = st.log[st.log.length - 1]
      const mv = l.from !== l.to ? ` · #${l.from} → #${l.to}` : ''
      message = `${teamName.get(l.teamId)} · ${l.problem}: ${l.visual === 'first' ? '🎈 FIRST SOLVE!' : verdictLabel(l.verdict)}${mv}`
    } else message = 'Ready — starting from the bottom of the frozen standings.'
  }

  const curProblem = st?.curSubId != null ? data.submissions.find((x) => x.id === st.curSubId)?.problem ?? null : st?.log.length ? st.log[st.log.length - 1].problem : null

  return (
    <div className="app">
      <header>
        <div className="title">
          <h1>{data.contest.name}</h1>
          {isAdmin && <span className="badge admin">ADMIN</span>}
          <span className={`badge phase-${phase}`}>{phase.replace(/_/g, ' ')}</span>
          <span className="badge">{data.contest.type}</span>
          <span className={`badge src-${data.source}`}>
            {data.source === 'demo' ? 'DEMO DATA' : data.source === 'cache' ? 'SAVED DATA' : isAdmin && data.managerView ? 'LIVE · manager view' : 'LIVE'}
          </span>
          {verification && (
            <span className={`badge ${verification.mismatches.length ? 'warn' : 'ok'}`} title={verification.mismatches.slice(0, 20).join('\n') || 'Our scoring matches the official standings'}>
              {verification.mismatches.length ? `⚠ ${verification.mismatches.length} score mismatches` : `✓ matches official (${verification.checked})`}
            </span>
          )}
        </div>
        <div className="tools">
          <span className="clock" title="Contest time">⏱ {running ? hm(nowSec) : hm(data.contest.durationSec)}</span>
          {isAdmin && (
            <>
              <label title="Length of the frozen (blind) period">
                Blind
                <input
                  type="number"
                  min={0}
                  max={Math.floor(data.contest.durationSec / 60)}
                  value={blindMin}
                  disabled={!!st}
                  onChange={(e) => {
                    const v = Math.max(0, Number(e.target.value) || 0)
                    setBlindOverride(v)
                    lsSet(`blind-${contestId}`, String(v))
                  }}
                />
                min
              </label>
              <label>
                <input type="checkbox" checked={showFinal} disabled={!!st} onChange={(e) => setShowFinal(e.target.checked)} /> Show final
              </label>
            </>
          )}
          <button onClick={reload} disabled={!!st || data.source === 'demo'} title="Refresh data">⟳</button>
          <button onClick={onToggleTheme} title="Toggle theme">{theme === 'dark' ? '☀' : '🌙'}</button>
          {isAdmin && (
            <>
              <button onClick={() => setSettingsOpen(true)} disabled={!!st} title="Configure contest ID, API credentials, and freeze settings">
                ⚙ Settings
              </button>
              <a className="btn-link" href="/" target="_blank" rel="noreferrer" title="Open public user scoreboard">
                Public view ↗
              </a>
              <button onClick={onLogout} title="Sign out of admin">
                Log out
              </button>
            </>
          )}
        </div>
      </header>

      {error && <div className="notice warn">⚠ {error}</div>}
      {data.contest.type !== 'ICPC' && <div className="notice warn">This contest is of type {data.contest.type}; scoring here follows ICPC rules (solved, then penalty).</div>}
      {frozen && !st && (
        <div className="notice freeze">
          ❄ Scoreboard frozen at {hm(freezeAt)} — {hiddenCount} submission{hiddenCount === 1 ? '' : 's'} hidden. Cells marked <b>?</b> are waiting to be unfrozen.
        </div>
      )}

      {isAdmin && (
        <Controls
          active={!!st}
          canStart={frozen && hiddenCount > 0}
          startHint={startHint}
          running={reveal.running}
          finished={st?.phase === 'finished'}
          busy={st?.phase === 'pending'}
          speed={speed}
          follow={follow}
          onFollow={setFollow}
          revealed={st?.revealed ?? 0}
          total={st?.total ?? 0}
          message={message}
          onStart={reveal.start}
          onToggle={() => reveal.setRunning((r) => !r)}
          onNext={reveal.stepOnce}
          onRestart={reveal.restart}
          onSkip={reveal.skip}
          onExit={reveal.exit}
          onSpeed={setSpeed}
        />
      )}

      <main>
        <Scoreboard
          rows={rows}
          problems={data.problems}
          curTeamId={st?.curTeamId ?? null}
          curProblem={curProblem}
          version={st?.version ?? 0}
          move={st?.move ?? null}
          moveMs={moveMs}
          follow={follow && !!st}
        />
        <Feed items={feed} title={st ? 'Reveal log' : frozen ? 'Submissions (before freeze)' : 'Latest submissions'} />
      </main>

      <footer>
        <span className="legend"><i className="lg first" /> First solve 🎈🎈</span>
        <span className="legend"><i className="lg ac" /> Accepted</span>
        <span className="legend"><i className="lg wa" /> Rejected</span>
        <span className="legend"><i className="lg pending" /> Pending</span>
        <span className="legend"><i className="lg frozen" /> Frozen / hidden</span>
      </footer>

      {isAdmin && (
        <AdminSettings
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          onSaved={reload}
          onUnauthorized={onUnauthorized}
        />
      )}
    </div>
  )
}

export default function App() {
  const isAdminRoute = /^\/admin(\/|$)/.test(window.location.pathname)
  const [theme, setTheme] = useState<string>(() => lsGet('theme') ?? (window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'))
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    lsSet('theme', theme)
  }, [theme])

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
  const admin = useAdminSession(isAdminRoute)

  if (!isAdminRoute) {
    return <ScoreboardPage mode="user" theme={theme} onToggleTheme={toggleTheme} />
  }

  if (admin.checking) {
    return <div className="center">Checking admin session…</div>
  }

  if (!admin.authenticated) {
    return (
      <AdminLogin
        configured={admin.configured}
        error={admin.authError}
        submitting={admin.submitting}
        theme={theme}
        onToggleTheme={toggleTheme}
        onLogin={admin.login}
      />
    )
  }

  return (
    <ScoreboardPage
      mode="admin"
      theme={theme}
      onToggleTheme={toggleTheme}
      onLogout={admin.logout}
      onUnauthorized={admin.expire}
    />
  )
}
