// Local server: serves both User (/) and Admin (/admin) pages and proxies signed Codeforces API calls.
// The API secret and admin password stay here (read from .env / data/settings.json) and never reach the browser.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  checkLoginRateLimit,
  clearCookieHeader,
  clearLoginFailures,
  clientIp,
  hashPassword,
  isAdminConfigured,
  isAdminRequest,
  readJsonBody,
  recordLoginFailure,
  sessionCookieHeader,
  signSession,
  verifyPassword,
} from './auth.mjs'
import { getContest, invalidateContestCache } from './cf.mjs'
import { getSettings, toSafeAdminSettings, updateSettings } from './settings.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const isDev = process.argv.includes('--dev')

function loadEnv(file) {
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
loadEnv(path.join(root, '.env'))

const PORT = Number(process.env.PORT || 5173)
const CACHE_DIR = path.join(root, 'data')

// ---- HTTP ----
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.map': 'application/json' }
const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'no-referrer',
}

function sendJson(res, obj, status = 200, extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...SEC_HEADERS, ...extraHeaders })
  res.end(JSON.stringify(obj))
}

let vite = null
if (isDev) {
  const { createServer } = await import('vite')
  vite = await createServer({ root, server: { middlewareMode: true }, appType: 'spa' })
}

const server = http.createServer(async (req, res) => {
  let url
  try {
    url = new URL(req.url || '/', 'http://localhost')
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain' })
    return res.end('Bad Request')
  }

  if (url.pathname === '/api/config') {
    const settings = await getSettings()
    return sendJson(res, {
      contestId: settings.contestId,
      hasKey: Boolean(settings.apiKey && settings.apiSecret),
      asManager: settings.asManager,
      adminConfigured: isAdminConfigured(settings),
      isAdmin: isAdminRequest(req, settings),
    })
  }

  if (url.pathname === '/api/admin/session') {
    const settings = await getSettings()
    return sendJson(res, { authenticated: isAdminRequest(req, settings), configured: isAdminConfigured(settings) })
  }

  if (url.pathname === '/api/admin/login') {
    if (req.method !== 'POST') return sendJson(res, { ok: false, error: 'Method not allowed' }, 405)
    const settings = await getSettings()
    if (!isAdminConfigured(settings)) return sendJson(res, { ok: false, error: 'ADMIN_PASSWORD_HASH is not configured on the server.' }, 503)
    const ip = clientIp(req)
    const limit = checkLoginRateLimit(ip)
    if (!limit.allowed) {
      return sendJson(res, { ok: false, error: `Too many failed attempts. Try again in ${limit.retryAfterSec}s.` }, 429, {
        'Retry-After': String(limit.retryAfterSec),
      })
    }
    let body
    try {
      body = await readJsonBody(req)
    } catch (e) {
      return sendJson(res, { ok: false, error: e?.message || 'Invalid request body' }, e?.statusCode || 400)
    }
    if (!verifyPassword(body?.password, settings)) {
      recordLoginFailure(ip)
      return sendJson(res, { ok: false, error: 'Incorrect password.' }, 401)
    }
    clearLoginFailures(ip)
    return sendJson(res, { ok: true }, 200, { 'Set-Cookie': sessionCookieHeader(signSession(undefined, settings), req) })
  }

  if (url.pathname === '/api/admin/logout') {
    if (req.method !== 'POST') return sendJson(res, { ok: false, error: 'Method not allowed' }, 405)
    return sendJson(res, { ok: true }, 200, { 'Set-Cookie': clearCookieHeader(req) })
  }

  if (url.pathname === '/api/admin/settings') {
    const settings = await getSettings()
    if (!isAdminRequest(req, settings)) return sendJson(res, { ok: false, unauthorized: true, error: 'Admin login required' }, 401)
    if (req.method === 'GET') return sendJson(res, { ok: true, settings: toSafeAdminSettings(settings) })
    if (req.method !== 'PUT' && req.method !== 'POST') return sendJson(res, { ok: false, error: 'Method not allowed' }, 405)
    let body
    try {
      body = await readJsonBody(req)
    } catch (e) {
      return sendJson(res, { ok: false, error: e?.message || 'Invalid request body' }, e?.statusCode || 400)
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
      if (body.newAdminPassword.length < 6) return sendJson(res, { ok: false, error: 'New admin password must be at least 6 characters.' }, 400)
      patch.adminPasswordHash = hashPassword(body.newAdminPassword)
    }
    try {
      const updated = await updateSettings(patch)
      invalidateContestCache()
      return sendJson(res, { ok: true, settings: toSafeAdminSettings(updated) }, 200, {
        'Set-Cookie': sessionCookieHeader(signSession(undefined, updated), req),
      })
    } catch (e) {
      return sendJson(res, { ok: false, error: e?.message || 'Failed to update settings' }, e?.statusCode || 500)
    }
  }

  if (url.pathname === '/api/contest') {
    const settings = await getSettings()
    const wantsAdmin = url.searchParams.get('admin') === '1'
    if (wantsAdmin) {
      if (!isAdminRequest(req, settings)) return sendJson(res, { ok: false, unauthorized: true, error: 'Admin login required' }, 401)
      return sendJson(res, await getContest({ isAdmin: true, cacheDir: CACHE_DIR, settings }))
    }
    return sendJson(res, await getContest({ isAdmin: false, cacheDir: CACHE_DIR, settings }))
  }

  if (vite) return vite.middlewares(req, res, () => { res.statusCode = 404; res.end('Not found') })

  const dist = path.join(root, 'dist')
  let file = path.join(dist, path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''))
  if ((file !== dist && !file.startsWith(dist + path.sep)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html')
  if (!fs.existsSync(file)) { res.statusCode = 500; return res.end('Run "npm run build" first (or use "npm start").') }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', ...SEC_HEADERS })
  fs.createReadStream(file).pipe(res)
})

const boot = await getSettings()
server.listen(PORT, () => {
  console.log(`\n  CF Live Scoreboard`)
  console.log(`  User page   →  http://localhost:${PORT}/`)
  console.log(`  Admin page  →  http://localhost:${PORT}/admin`)
  console.log(`  Contest ${boot.contestId} · API key ${boot.apiKey && boot.apiSecret ? 'configured' : 'NOT set (demo data)'} · manager view ${boot.asManager ? 'on' : 'off'} · admin password ${isAdminConfigured(boot) ? 'set' : 'NOT set'}\n`)
})
