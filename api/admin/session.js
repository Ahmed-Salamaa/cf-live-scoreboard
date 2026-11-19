import { isAdminConfigured, isAdminRequest } from '../../server/auth.mjs'

export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  res.statusCode = 200
  res.end(
    JSON.stringify({
      authenticated: isAdminRequest(req),
      configured: isAdminConfigured(),
    }),
  )
}
