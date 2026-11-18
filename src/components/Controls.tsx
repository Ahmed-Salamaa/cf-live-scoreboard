interface Props {
  active: boolean
  canStart: boolean
  startHint: string | null
  running: boolean
  finished: boolean
  busy: boolean
  speed: number
  follow: boolean
  onFollow(v: boolean): void
  revealed: number
  total: number
  message: string
  onStart(): void
  onToggle(): void
  onNext(): void
  onRestart(): void
  onSkip(): void
  onExit(): void
  onSpeed(n: number): void
}

export function Controls(p: Props) {
  const pct = p.total ? Math.round((p.revealed / p.total) * 100) : 0
  if (!p.active) {
    return (
      <div className="controls">
        <button className="primary" disabled={!p.canStart} onClick={p.onStart}>
          ▶ Start unfreezing
        </button>
        <span className="muted">{p.startHint}</span>
      </div>
    )
  }
  return (
    <div className="controls">
      <button className="primary" onClick={p.onToggle} disabled={p.finished} title="Space">
        {p.running ? '⏸ Pause' : '▶ Resume'}
      </button>
      <button onClick={p.onNext} disabled={p.running || p.busy || p.finished} title="→ or N">
        Reveal next
      </button>
      <label className="speed">
        Speed
        <input type="range" min={1} max={10} value={p.speed} onChange={(e) => p.onSpeed(Number(e.target.value))} />
        <span>{p.speed}×</span>
      </label>
      <label className="speed" title="Scroll to keep the current team in view">
        <input type="checkbox" checked={p.follow} onChange={(e) => p.onFollow(e.target.checked)} />
        Follow
      </label>
      <button onClick={p.onSkip} disabled={p.finished}>
        Skip to final
      </button>
      <button onClick={p.onRestart}>↺ Restart</button>
      <button onClick={p.onExit}>Exit</button>
      <div className="progress" title={`${p.revealed} of ${p.total} hidden submissions revealed`}>
        <div className="bar" style={{ width: `${pct}%` }} />
        <span>
          {p.revealed} / {p.total} revealed
        </span>
      </div>
      <div className="status" aria-live="polite">
        {p.message}
      </div>
    </div>
  )
}
