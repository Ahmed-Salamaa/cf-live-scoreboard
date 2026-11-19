import {
  checkLoginRateLimit,
  clearLoginFailures,
  clientIp,
  isAdminConfigured,
  readJsonBody,
  recordLoginFailure,
  sessionCookieHeader,
  signSession,
  verifyPassword,
} from '../../server/auth.mjs'

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'POST') {
    res.statusCode = 405
    res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }))
    return
  }

  if (!isAdminConfigured()) {
    res.statusCode = 503
    res.end(JSON.stringify({ ok: false, error: 'ADMIN_PASSWORD_HASH is not configured on the server.' }))
    return
  }

  const ip = clientIp(req)
  const limit = checkLoginRateLimit(ip)
  if (!limit.allowed) {
    res.setHeader('Retry-After', String(limit.retryAfterSec))
    res.statusCode = 429
    res.end(JSON.stringify({ ok: false, error: `Too many failed attempts. Try again in ${limit.retryAfterSec}s.` }))
    return
  }

  let body
  try {
    body = await readJsonBody(req)
  } catch (e) {
    res.statusCode = e?.statusCode || 400
    res.end(JSON.stringify({ ok: false, error: e?.message || 'Invalid request body' }))
    return
  }

  if (!verifyPassword(body?.password)) {
    recordLoginFailure(ip)
    res.statusCode = 401
    res.end(JSON.stringify({ ok: false, error: 'Incorrect password.' }))
    return
  }

  clearLoginFailures(ip)
  const token = signSession()
  res.setHeader('Set-Cookie', sessionCookieHeader(token, req))
  res.statusCode = 200
  res.end(JSON.stringify({ ok: true }))
}
