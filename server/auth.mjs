import crypto from 'node:crypto'

export const COOKIE_NAME = 'cf_admin'
export const JWT_SLIDING_TTL_SEC = 15 * 60 // 15 minutes idle/sliding limit
export const JWT_ABSOLUTE_MAX_SEC = 4 * 60 * 60 // 4 hours hard cap (cannot refresh forever)
const JWT_REFRESH_AFTER_SEC = 2 * 60 // re-issue cookie if older than 2 minutes
const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const SCRYPT_KEYLEN = 64

export function getAdminPasswordHash(settings) {
  return settings?.adminPasswordHash ?? (process.env.ADMIN_PASSWORD_HASH || '')
}

export function getAdminPassword(settings) {
  return settings?.adminPassword ?? (process.env.ADMIN_PASSWORD || '')
}

export function isAdminConfigured(settings) {
  return Boolean(getAdminPasswordHash(settings) || getAdminPassword(settings))
}

function signingKey(settings) {
  const apiSecret = settings?.apiSecret ?? (process.env.CF_API_SECRET || '')
  const jwtSecret = process.env.JWT_SECRET || ''
  return crypto
    .createHash('sha256')
    .update(`cf-live-scoreboard-jwt:${jwtSecret}:${getAdminPasswordHash(settings)}:${getAdminPassword(settings)}:${apiSecret}`)
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

export function verifyPassword(input, settings) {
  if (typeof input !== 'string' || !input) return false
  const storedHash = getAdminPasswordHash(settings)
  if (storedHash) return verifyScryptHash(input, storedHash)
  const expected = getAdminPassword(settings)
  if (!expected) return false
  const a = crypto.createHash('sha256').update(input).digest()
  const b = crypto.createHash('sha256').update(expected).digest()
  return crypto.timingSafeEqual(a, b)
}

const JWT_HEADER_B64 = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')

/**
 * Sign a short-lived HS256 JWT (15m sliding expiry, 4h absolute maxExp cap).
 * Pass `maxExp` when refreshing an existing session so the absolute cap is preserved.
 */
export function signSession(nowSec = Math.floor(Date.now() / 1000), settings, maxExp = nowSec + JWT_ABSOLUTE_MAX_SEC) {
  const cappedMax = Math.min(maxExp, nowSec + JWT_ABSOLUTE_MAX_SEC)
  const exp = Math.min(nowSec + JWT_SLIDING_TTL_SEC, cappedMax)
  const payload = Buffer.from(
    JSON.stringify({ sub: 'admin', role: 'admin', iat: nowSec, exp, maxExp: cappedMax }),
  ).toString('base64url')
  const signingInput = `${JWT_HEADER_B64}.${payload}`
  const sig = crypto.createHmac('sha256', signingKey(settings)).update(signingInput).digest('base64url')
  return `${signingInput}.${sig}`
}

/** Verify an HS256 JWT and return its decoded payload, or null if invalid/expired. */
export function verifySessionPayload(token, nowSec = Math.floor(Date.now() / 1000), settings) {
  if (!isAdminConfigured(settings) || typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [headerB64, payloadB64, sig] = parts
  try {
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'))
    if (header?.alg !== 'HS256' || header?.typ !== 'JWT') return null
  } catch {
    return null
  }
  const signingInput = `${headerB64}.${payloadB64}`
  const expected = crypto.createHmac('sha256', signingKey(settings)).update(signingInput).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  try {
    const data = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
    if (
      data?.role !== 'admin' ||
      typeof data.iat !== 'number' ||
      typeof data.exp !== 'number' ||
      typeof data.maxExp !== 'number'
    ) {
      return null
    }
    if (data.exp <= nowSec || data.maxExp <= nowSec || data.exp > data.maxExp) return null
    return data
  } catch {
    return null
  }
}

export function verifySession(token, nowSec = Math.floor(Date.now() / 1000), settings) {
  return verifySessionPayload(token, nowSec, settings) !== null
}

/**
 * Refresh a valid JWT if it is older than JWT_REFRESH_AFTER_SEC and still before maxExp.
 * Returns { token, maxAge } or null if no refresh is needed or possible.
 */
export function refreshSession(payload, nowSec = Math.floor(Date.now() / 1000), settings) {
  if (!payload || nowSec >= payload.maxExp) return null
  if (nowSec - payload.iat < JWT_REFRESH_AFTER_SEC) return null
  const nextExp = Math.min(nowSec + JWT_SLIDING_TTL_SEC, payload.maxExp)
  if (nextExp <= payload.exp) return null
  const token = signSession(nowSec, settings, payload.maxExp)
  return { token, maxAge: Math.max(1, nextExp - nowSec) }
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

export function getAdminSession(req, settings, nowSec = Math.floor(Date.now() / 1000)) {
  const cookies = parseCookies(req)
  if (cookies[COOKIE_NAME]) {
    const payload = verifySessionPayload(cookies[COOKIE_NAME], nowSec, settings)
    if (payload) return payload
  }
  const auth = req?.headers?.authorization
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return verifySessionPayload(auth.slice(7).trim(), nowSec, settings)
  }
  return null
}

export function isAdminRequest(req, settings) {
  return getAdminSession(req, settings) !== null
}

function isHttps(req) {
  return Boolean(process.env.VERCEL || req?.headers?.['x-forwarded-proto'] === 'https')
}

export function sessionCookieHeader(token, req, maxAge = JWT_SLIDING_TTL_SEC) {
  const parts = [`${COOKIE_NAME}=${encodeURIComponent(token)}`, 'HttpOnly', 'SameSite=Lax', 'Path=/', `Max-Age=${maxAge}`]
  if (isHttps(req)) parts.push('Secure')
  return parts.join('; ')
}

export function maybeRefreshCookieHeader(session, req, settings) {
  const refreshed = refreshSession(session, undefined, settings)
  return refreshed ? sessionCookieHeader(refreshed.token, req, refreshed.maxAge) : null
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
