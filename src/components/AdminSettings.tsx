import { useEffect, useState, type FormEvent } from 'react'

interface SafeSettings {
  contestId: string
  apiKey: string
  hasKey: boolean
  hasSecret: boolean
  asManager: boolean
  freezeMinOverride: number | null
  forcePublicFreeze: boolean
  storage: 'redis' | 'file' | 'memory'
}

interface Props {
  open: boolean
  onClose(): void
  onSaved(): void
  onUnauthorized?: () => void
}

export function AdminSettings({ open, onClose, onSaved, onUnauthorized }: Props) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)

  const [contestId, setContestId] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [apiSecret, setApiSecret] = useState('')
  const [hasSecret, setHasSecret] = useState(false)
  const [clearCredentials, setClearCredentials] = useState(false)
  const [asManager, setAsManager] = useState(true)
  const [freezeMinOverride, setFreezeMinOverride] = useState('')
  const [forcePublicFreeze, setForcePublicFreeze] = useState(false)
  const [newAdminPassword, setNewAdminPassword] = useState('')
  const [storage, setStorage] = useState<'redis' | 'file' | 'memory'>('file')

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setSavedMsg(null)
    setApiSecret('')
    setClearCredentials(false)
    setNewAdminPassword('')
    fetch('/api/admin/settings', { credentials: 'same-origin' })
      .then(async (res) => {
        if (res.status === 401) {
          onUnauthorized?.()
          return null
        }
        const json = await res.json()
        if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to load settings')
        return json.settings as SafeSettings
      })
      .then((s) => {
        if (cancelled || !s) return
        setContestId(s.contestId)
        setApiKey(s.apiKey)
        setHasSecret(s.hasSecret)
        setAsManager(s.asManager)
        setFreezeMinOverride(s.freezeMinOverride != null ? String(s.freezeMinOverride) : '')
        setForcePublicFreeze(s.forcePublicFreeze)
        setStorage(s.storage)
      })
      .catch((e) => {
        if (!cancelled) setError(String(e.message || e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, onUnauthorized])

  if (!open) return null

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setSavedMsg(null)
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          contestId,
          apiKey,
          apiSecret: apiSecret.trim() || undefined,
          clearCredentials,
          asManager,
          freezeMinOverride: freezeMinOverride.trim() === '' ? null : Number(freezeMinOverride),
          forcePublicFreeze,
          newAdminPassword: newAdminPassword || undefined,
        }),
      })
      if (res.status === 401) {
        onUnauthorized?.()
        return
      }
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to save settings')
      const s = json.settings as SafeSettings
      setContestId(s.contestId)
      setApiKey(s.apiKey)
      setHasSecret(s.hasSecret)
      setApiSecret('')
      setClearCredentials(false)
      setAsManager(s.asManager)
      setFreezeMinOverride(s.freezeMinOverride != null ? String(s.freezeMinOverride) : '')
      setForcePublicFreeze(s.forcePublicFreeze)
      setNewAdminPassword('')
      setStorage(s.storage)
      setSavedMsg('Settings saved and scoreboard refreshed.')
      onSaved()
    } catch (err) {
      setError(String((err as Error)?.message || err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>Admin Settings</h2>
            <span className="muted storage-hint">
              {storage === 'redis'
                ? 'Storage: Redis / Vercel KV (persistent)'
                : storage === 'file'
                  ? 'Storage: local file (data/settings.json)'
                  : 'Storage: in-memory on Vercel (add Upstash Redis / Vercel KV env vars to persist across cold starts)'}
            </span>
          </div>
          <button type="button" onClick={onClose} title="Close">✕</button>
        </div>

        {loading ? (
          <p className="muted">Loading settings…</p>
        ) : (
          <form onSubmit={handleSubmit} className="settings-form">
            {error && <div className="notice warn">⚠ {error}</div>}
            {savedMsg && <div className="notice ok">✓ {savedMsg}</div>}

            <label>
              Contest ID
              <input
                type="text"
                inputMode="numeric"
                required
                placeholder="e.g. 732371"
                value={contestId}
                onChange={(e) => setContestId(e.target.value)}
              />
            </label>

            <label>
              Codeforces API Key
              <input
                type="text"
                autoComplete="off"
                placeholder="Leave blank for public/demo mode"
                value={apiKey}
                disabled={clearCredentials}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </label>

            <label>
              Codeforces API Secret {hasSecret ? <span className="muted">(configured)</span> : <span className="muted">(not set)</span>}
              <input
                type="password"
                autoComplete="new-password"
                placeholder={hasSecret ? '•••••••• (leave blank to keep current)' : 'Enter API secret'}
                value={apiSecret}
                disabled={clearCredentials}
                onChange={(e) => setApiSecret(e.target.value)}
              />
            </label>

            <label className="check-row">
              <input type="checkbox" checked={clearCredentials} onChange={(e) => setClearCredentials(e.target.checked)} />
              Clear stored API key &amp; secret
            </label>

            <label className="check-row">
              <input type="checkbox" checked={asManager} onChange={(e) => setAsManager(e.target.checked)} />
              Use manager view (<code>asManager=true</code>) for unfrozen verdicts
            </label>

            <label>
              Freeze duration override (minutes) <span className="muted">(optional — blank uses contest default)</span>
              <input
                type="number"
                min={0}
                max={10000}
                placeholder="Default"
                value={freezeMinOverride}
                onChange={(e) => setFreezeMinOverride(e.target.value)}
              />
            </label>

            <label className="check-row">
              <input type="checkbox" checked={forcePublicFreeze} onChange={(e) => setForcePublicFreeze(e.target.checked)} />
              Keep public scoreboard (<code>/</code>) frozen even after contest finishes
            </label>

            <label>
              Change Admin Password <span className="muted">(optional — stored as salted scrypt hash)</span>
              <input
                type="password"
                autoComplete="new-password"
                placeholder="Leave blank to keep current password"
                value={newAdminPassword}
                onChange={(e) => setNewAdminPassword(e.target.value)}
              />
            </label>

            <div className="modal-actions">
              <button type="button" onClick={onClose}>Close</button>
              <button type="submit" className="primary" disabled={saving}>
                {saving ? 'Saving…' : 'Save & Reload'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
