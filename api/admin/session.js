import { getAdminSession, isAdminConfigured, maybeRefreshCookieHeader } from '../../server/auth.mjs'
import { getSettings } from '../../server/settings.mjs'

export default async function handler(req, res) {
  const settings = await getSettings()
  const session = getAdminSession(req, settings)
  if (session) {
    const refreshCookie = maybeRefreshCookieHeader(session, req, settings)
    if (refreshCookie) res.setHeader('Set-Cookie', refreshCookie)
  }
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  res.statusCode = 200
  res.end(
    JSON.stringify({
      authenticated: Boolean(session),
      configured: isAdminConfigured(settings),
    }),
  )
}
