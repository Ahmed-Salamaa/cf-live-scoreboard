import { isAdminConfigured, isAdminRequest } from '../server/auth.mjs'
import { getSettings } from '../server/settings.mjs'

export default async function handler(req, res) {
  const settings = await getSettings()
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  res.statusCode = 200
  res.end(
    JSON.stringify({
      contestId: settings.contestId,
      hasKey: Boolean(settings.apiKey && settings.apiSecret),
      asManager: settings.asManager,
      adminConfigured: isAdminConfigured(settings),
      isAdmin: isAdminRequest(req, settings),
    }),
  )
}
