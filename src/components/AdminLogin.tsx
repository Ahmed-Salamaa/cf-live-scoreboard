import { useState, type FormEvent } from 'react'

interface Props {
  configured: boolean
  error: string | null
  submitting: boolean
  theme: string
  onToggleTheme(): void
  onLogin(password: string): Promise<boolean>
}

export function AdminLogin({ configured, error, submitting, theme, onToggleTheme, onLogin }: Props) {
  const [password, setPassword] = useState('')

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!password || submitting) return
    const ok = await onLogin(password)
    if (ok) setPassword('')
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-head">
          <div>
            <span className="badge admin">ADMIN</span>
            <h1>Scoreboard Admin</h1>
          </div>
          <button type="button" onClick={onToggleTheme} title="Toggle theme">
            {theme === 'dark' ? '☀' : '🌙'}
          </button>
        </div>

        <p className="muted">Enter the admin password to access manager data and unfreezing controls.</p>

        {!configured && (
          <div className="notice warn">
            ⚠ <code>ADMIN_PASSWORD_HASH</code> is not set on the server. Generate one with <code>npm run hash-password</code> and add it to <code>.env</code> or Vercel Environment Variables.
          </div>
        )}

        {error && <div className="notice warn">⚠ {error}</div>}

        <form onSubmit={handleSubmit} className="login-form">
          <label>
            Password
            <input
              type="password"
              autoFocus
              autoComplete="current-password"
              placeholder="Enter admin password"
              value={password}
              disabled={!configured || submitting}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button className="primary" type="submit" disabled={!configured || submitting || !password}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div className="login-foot">
          <a href="/">← Back to public scoreboard</a>
        </div>
      </div>
    </div>
  )
}
