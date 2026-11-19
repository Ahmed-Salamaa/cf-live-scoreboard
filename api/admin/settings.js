import { getAdminSession, hashPassword, maybeRefreshCookieHeader, readJsonBody, sessionCookieHeader, signSession } from '../../server/auth.mjs'
import { invalidateContestCache } from '../../server/cf.mjs'
import { getSettings, toSafeAdminSettings, updateSettings } from '../../server/settings.mjs'

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'private, no-store')

  const settings = await getSettings()
  const session = getAdminSession(req, settings)
  if (!session) {
    res.statusCode = 401
    res.end(JSON.stringify({ ok: false, unauthorized: true, error: 'Admin login required' }))
    return
  }

  if (req.method === 'GET') {
    const refreshCookie = maybeRefreshCookieHeader(session, req, settings)
    if (refreshCookie) res.setHeader('Set-Cookie', refreshCookie)
    res.statusCode = 200
    res.end(JSON.stringify({ ok: true, settings: toSafeAdminSettings(settings) }))
    return
  }

  if (req.method !== 'PUT' && req.method !== 'POST') {
    res.statusCode = 405
    res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }))
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

  const patch = {
    contestId: body?.contestId,
    apiKey: body?.apiKey,
    apiSecret: body?.apiSecret,
    clearCredentials: body?.clearCredentials,
    asManager: body?.asManager,
    freezeMinOverride: body?.freezeMinOverride,
    forcePublicFreeze: body?.forcePublicFreeze,
  }

  if (typeof body?.newAdminPassword === 'string' && body.newAdminPassword.length > 0) {
    if (body.newAdminPassword.length < 6) {
      res.statusCode = 400
      res.end(JSON.stringify({ ok: false, error: 'New admin password must be at least 6 characters.' }))
      return
    }
    patch.adminPasswordHash = hashPassword(body.newAdminPassword)
  }

  try {
    const updated = await updateSettings(patch)
    invalidateContestCache()
    // Re-issue JWT with the latest signing key while preserving the original maxExp cap
    const nowSec = Math.floor(Date.now() / 1000)
    const token = signSession(nowSec, updated, session.maxExp)
    const maxAge = Math.max(1, Math.min(nowSec + 15 * 60, session.maxExp) - nowSec)
    res.setHeader('Set-Cookie', sessionCookieHeader(token, req, maxAge))
    res.statusCode = 200
    res.end(JSON.stringify({ ok: true, settings: toSafeAdminSettings(updated) }))
  } catch (e) {
    res.statusCode = e?.statusCode || 500
    res.end(JSON.stringify({ ok: false, error: e?.message || 'Failed to update settings' }))
  }
}
