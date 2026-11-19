import crypto from 'node:crypto'

export const COOKIE_NAME = 'cf_admin'
const SESSION_TTL_SEC = 60 * 60 * 12 // 12 hours
const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const SCRYPT_KEYLEN = 64

export function getAdminPasswordHash() {
  return process.env.ADMIN_PASSWORD_HASH || ''
}

export function getAdminPassword() {
  return process.env.ADMIN_PASSWORD || ''
}

export function isAdminConfigured() {
  return Boolean(getAdminPasswordHash() || getAdminPassword())
}

function signingKey() {
  return crypto
    .createHash('sha256')
    .update(`cf-live-scoreboard:${getAdminPasswordHash()}:${getAdminPassword()}:${process.env.CF_API_SECRET || ''}`)
    .digest()
}

/** Hash a password with salted scrypt (memory-hard KDF, 512-bit derived key). */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16)
  const key = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024 })
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('hex')}$${key.toString('hex')}`
}

function verifyScryptHash(input, stored) {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const N = Number(parts[1])
  const r = Number(parts[2])
  const p = Number(parts[3])
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p) || N < 1024 || r < 1 || p < 1) return false
  try {
    const salt = Buffer.from(parts[4], 'hex')
    const expected = Buffer.from(parts[5], 'hex')
    if (salt.length < 8 || expected.length < 32) return false
    const derived = crypto.scryptSync(input, salt, expected.length, { N, r, p, maxmem: 64 * 1024 * 1024 })
    return crypto.timingSafeEqual(derived, expected)
  } catch {
    return false
  }
}

export function verifyPassword(input) {
  if (typeof input !== 'string' || !input) return false
  const storedHash = getAdminPasswordHash()
  if (storedHash) return verifyScryptHash(input, storedHash)
  const expected = getAdminPassword()
  if (!expected) return false
  const a = crypto.createHash('sha256').update(input).digest()
  const b = crypto.createHash('sha256').update(expected).digest()
  return crypto.timingSafeEqual(a, b)
}

export function signSession(nowSec = Math.floor(Date.now() / 1000)) {
  const payload = Buffer.from(JSON.stringify({ role: 'admin', exp: nowSec + SESSION_TTL_SEC })).toString('base64url')
  const sig = crypto.createHmac('sha256', signingKey()).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

export function verifySession(token, nowSec = Math.floor(Date.now() / 1000)) {
  if (!isAdminConfigured() || typeof token !== 'string') return false
  const parts = token.split('.')
  if (parts.length !== 2) return false
  const [payload, sig] = parts
  const expected = crypto.createHmac('sha256', signingKey()).update(payload).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    return data?.role === 'admin' && typeof data.exp === 'number' && data.exp > nowSec
  } catch {
    return false
  }
}

export function parseCookies(req) {
  const raw = req?.headers?.cookie
  const out = {}
  if (!raw || typeof raw !== 'string') return out
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=')
    if (idx < 0) continue
    const k = part.slice(0, idx).trim()
    const v = part.slice(idx + 1).trim()
    if (k) {
      try {
        out[k] = decodeURIComponent(v)
      } catch {
        out[k] = v
      }
    }
  }
  return out
}

export function isAdminRequest(req) {
  const cookies = parseCookies(req)
  if (cookies[COOKIE_NAME] && verifySession(cookies[COOKIE_NAME])) return true
  const auth = req?.headers?.authorization
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return verifySession(auth.slice(7).trim())
  }
  return false
}

function isHttps(req) {
  return Boolean(process.env.VERCEL || req?.headers?.['x-forwarded-proto'] === 'https')
}

export function sessionCookieHeader(token, req) {
  const parts = [`${COOKIE_NAME}=${encodeURIComponent(token)}`, 'HttpOnly', 'SameSite=Lax', 'Path=/', `Max-Age=${SESSION_TTL_SEC}`]
  if (isHttps(req)) parts.push('Secure')
  return parts.join('; ')
}

export function clearCookieHeader(req) {
  const parts = [`${COOKIE_NAME}=`, 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=0']
  if (isHttps(req)) parts.push('Secure')
  return parts.join('; ')
}

export async function readJsonBody(req, maxBytes = 16384) {
  if (req.body && typeof req.body === 'object') return req.body
  if (typeof req.body === 'string') {
    if (Buffer.byteLength(req.body, 'utf8') > maxBytes) {
      const err = new Error('Payload too large')
      err.statusCode = 413
      throw err
    }
    try {
      return JSON.parse(req.body)
    } catch {
      return {}
    }
  }
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > maxBytes) {
      const err = new Error('Payload too large')
      err.statusCode = 413
      throw err
    }
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return {}
  }
}

// ---- In-memory login brute-force rate limiter ----
const MAX_FAILED_ATTEMPTS = 5
const WINDOW_MS = 15 * 60 * 1000
const attemptsByIp = new Map() // ip -> { count, resetAt }

export function clientIp(req) {
  const fwd = req?.headers?.['x-forwarded-for']
  if (typeof fwd === 'string' && fwd.trim()) return fwd.split(',')[0].trim()
  return req?.socket?.remoteAddress || 'unknown'
}

export function checkLoginRateLimit(ip, now = Date.now()) {
  const rec = attemptsByIp.get(ip)
  if (!rec) return { allowed: true, retryAfterSec: 0 }
  if (now >= rec.resetAt) {
    attemptsByIp.delete(ip)
    return { allowed: true, retryAfterSec: 0 }
  }
  if (rec.count >= MAX_FAILED_ATTEMPTS) {
    return { allowed: false, retryAfterSec: Math.ceil((rec.resetAt - now) / 1000) }
  }
  return { allowed: true, retryAfterSec: 0 }
}

export function recordLoginFailure(ip, now = Date.now()) {
  const rec = attemptsByIp.get(ip)
  if (!rec || now >= rec.resetAt) {
    attemptsByIp.set(ip, { count: 1, resetAt: now + WINDOW_MS })
  } else {
    rec.count += 1
  }
}

export function clearLoginFailures(ip) {
  attemptsByIp.delete(ip)
}
