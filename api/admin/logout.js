import { clearCookieHeader } from '../../server/auth.mjs'

export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }))
    return
  }
  res.setHeader('Set-Cookie', clearCookieHeader(req))
  res.statusCode = 200
  res.end(JSON.stringify({ ok: true }))
}
