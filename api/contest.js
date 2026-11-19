import { isAdminRequest } from '../server/auth.mjs'
import { getContest } from '../server/cf.mjs'
import { getSettings } from '../server/settings.mjs'

export default async function handler(req, res) {
  let wantsAdmin = false
  try {
    const url = new URL(req.url || '/', 'http://localhost')
    wantsAdmin = url.searchParams.get('admin') === '1'
  } catch {
    wantsAdmin = false
  }

  const settings = await getSettings()
  res.setHeader('Content-Type', 'application/json')

  if (wantsAdmin) {
    res.setHeader('Cache-Control', 'private, no-store')
    if (!isAdminRequest(req, settings)) {
      res.statusCode = 401
      res.end(JSON.stringify({ ok: false, unauthorized: true, error: 'Admin login required' }))
      return
    }
    const payload = await getContest({ isAdmin: true, settings })
    res.statusCode = 200
    res.end(JSON.stringify(payload))
    return
  }

  const payload = await getContest({ isAdmin: false, settings })
  res.setHeader('Cache-Control', payload.ok && payload.source === 'live' ? 'public, s-maxage=5, stale-while-revalidate=10' : 'no-store')
  res.statusCode = 200
  res.end(JSON.stringify(payload))
}
