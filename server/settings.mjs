import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SETTINGS_FILE = path.join(root, 'data', 'settings.json')
const REDIS_KEY = 'cf_live_scoreboard:settings'
const REDIS_CACHE_MS = 5000

function redisConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || ''
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || ''
  return url && token ? { url: url.replace(/\/+$/, ''), token } : null
}

export function storageMode() {
  if (redisConfig()) return 'redis'
  if (!process.env.VERCEL) return 'file'
  return 'memory'
}

function envDefaults() {
  return {
    contestId: process.env.CF_CONTEST_ID || '732371',
    apiKey: process.env.CF_API_KEY || '',
    apiSecret: process.env.CF_API_SECRET || '',
    asManager: (process.env.CF_AS_MANAGER ?? 'true') !== 'false',
    freezeMinOverride: null,
    forcePublicFreeze: false,
    adminPasswordHash: process.env.ADMIN_PASSWORD_HASH || '',
    adminPassword: process.env.ADMIN_PASSWORD || '',
  }
}

let memOverrides = {}
let redisLoadedAt = 0

async function readOverrides() {
  const mode = storageMode()
  if (mode === 'redis') {
    if (Date.now() - redisLoadedAt < REDIS_CACHE_MS) return memOverrides
    const { url, token } = redisConfig()
    try {
      const res = await fetch(`${url}/get/${encodeURIComponent(REDIS_KEY)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = await res.json().catch(() => null)
      if (json && typeof json.result === 'string' && json.result) {
        memOverrides = JSON.parse(json.result)
      }
      redisLoadedAt = Date.now()
    } catch (e) {
      console.warn(`[warn] Redis settings read failed: ${e.message}`)
    }
    return memOverrides
  }

  if (mode === 'file') {
    try {
      if (fs.existsSync(SETTINGS_FILE)) {
        return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))
      }
    } catch (e) {
      console.warn(`[warn] Settings file read failed: ${e.message}`)
    }
    return memOverrides
  }

  return memOverrides
}

async function writeOverrides(next) {
  memOverrides = { ...next }
  const mode = storageMode()
  if (mode === 'redis') {
    const { url, token } = redisConfig()
    const res = await fetch(`${url}/set/${encodeURIComponent(REDIS_KEY)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' },
      body: JSON.stringify(memOverrides),
    })
    if (!res.ok) throw new Error(`Redis save failed (HTTP ${res.status})`)
    redisLoadedAt = Date.now()
    return
  }

  if (mode === 'file') {
    fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true })
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(memOverrides, null, 2), { mode: 0o600 })
  }
}

export async function getSettings() {
  const base = envDefaults()
  const ov = await readOverrides()
  return {
    contestId: typeof ov.contestId === 'string' && ov.contestId.trim() ? ov.contestId.trim() : base.contestId,
    apiKey: typeof ov.apiKey === 'string' ? ov.apiKey : base.apiKey,
    apiSecret: typeof ov.apiSecret === 'string' ? ov.apiSecret : base.apiSecret,
    asManager: typeof ov.asManager === 'boolean' ? ov.asManager : base.asManager,
    freezeMinOverride: typeof ov.freezeMinOverride === 'number' && Number.isFinite(ov.freezeMinOverride) ? ov.freezeMinOverride : base.freezeMinOverride,
    forcePublicFreeze: typeof ov.forcePublicFreeze === 'boolean' ? ov.forcePublicFreeze : base.forcePublicFreeze,
    adminPasswordHash: typeof ov.adminPasswordHash === 'string' && ov.adminPasswordHash ? ov.adminPasswordHash : base.adminPasswordHash,
    adminPassword: base.adminPassword,
    storage: storageMode(),
  }
}

/** Safe subset of settings returned to the authenticated Admin UI (never exposes apiSecret or password hashes). */
export function toSafeAdminSettings(s) {
  return {
    contestId: s.contestId,
    apiKey: s.apiKey,
    hasKey: Boolean(s.apiKey),
    hasSecret: Boolean(s.apiSecret),
    asManager: s.asManager,
    freezeMinOverride: s.freezeMinOverride,
    forcePublicFreeze: s.forcePublicFreeze,
    storage: s.storage,
  }
}

export async function updateSettings(patch) {
  const current = await readOverrides()
  const next = { ...current }

  if (patch.contestId !== undefined) {
    const cid = String(patch.contestId).trim()
    if (!/^\d{1,10}$/.test(cid)) {
      const err = new Error('Contest ID must be a positive integer (e.g. 732371).')
      err.statusCode = 400
      throw err
    }
    next.contestId = cid
  }

  if (patch.clearCredentials === true) {
    next.apiKey = ''
    next.apiSecret = ''
  } else {
    if (patch.apiKey !== undefined) {
      next.apiKey = String(patch.apiKey).trim()
    }
    if (typeof patch.apiSecret === 'string' && patch.apiSecret.trim() !== '') {
      next.apiSecret = patch.apiSecret.trim()
    }
  }

  if (typeof patch.asManager === 'boolean') {
    next.asManager = patch.asManager
  }

  if (patch.freezeMinOverride !== undefined) {
    if (patch.freezeMinOverride === null || patch.freezeMinOverride === '') {
      next.freezeMinOverride = null
    } else {
      const n = Number(patch.freezeMinOverride)
      if (!Number.isFinite(n) || n < 0 || n > 10000) {
        const err = new Error('Freeze duration override must be a non-negative number of minutes.')
        err.statusCode = 400
        throw err
      }
      next.freezeMinOverride = Math.round(n)
    }
  }

  if (typeof patch.forcePublicFreeze === 'boolean') {
    next.forcePublicFreeze = patch.forcePublicFreeze
  }

  if (typeof patch.adminPasswordHash === 'string' && patch.adminPasswordHash.startsWith('scrypt$')) {
    next.adminPasswordHash = patch.adminPasswordHash
  }

  await writeOverrides(next)
  return getSettings()
}
