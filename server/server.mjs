// Local server: serves both User (/) and Admin (/admin) pages and proxies signed Codeforces API calls.
// The API secret and admin password stay here (read from .env) and never reach the browser.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  checkLoginRateLimit,
  clearCookieHeader,
  clearLoginFailures,
  clientIp,
  isAdminConfigured,
  isAdminRequest,
  readJsonBody,
  recordLoginFailure,
  sessionCookieHeader,
  signSession,
  verifyPassword,
} from './auth.mjs'
import { getContest } from './cf.mjs'

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
const CONTEST = process.env.CF_CONTEST_ID || '732371'
const HAS_KEY = Boolean(process.env.CF_API_KEY && process.env.CF_API_SECRET)
const AS_MANAGER = (process.env.CF_AS_MANAGER ?? 'true') !== 'false'
const CACHE_FILE = path.join(root, 'data', `contest-${CONTEST}.json`)

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
    return sendJson(res, {
      contestId: CONTEST,
      hasKey: HAS_KEY,
      asManager: AS_MANAGER,
      adminConfigured: isAdminConfigured(),
      isAdmin: isAdminRequest(req),
    })
  }

  if (url.pathname === '/api/admin/session') {
    return sendJson(res, { authenticated: isAdminRequest(req), configured: isAdminConfigured() })
  }

  if (url.pathname === '/api/admin/login') {
    if (req.method !== 'POST') return sendJson(res, { ok: false, error: 'Method not allowed' }, 405)
    if (!isAdminConfigured()) return sendJson(res, { ok: false, error: 'ADMIN_PASSWORD_HASH is not configured on the server.' }, 503)
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
    if (!verifyPassword(body?.password)) {
      recordLoginFailure(ip)
      return sendJson(res, { ok: false, error: 'Incorrect password.' }, 401)
    }
    clearLoginFailures(ip)
    return sendJson(res, { ok: true }, 200, { 'Set-Cookie': sessionCookieHeader(signSession(), req) })
  }

  if (url.pathname === '/api/admin/logout') {
    if (req.method !== 'POST') return sendJson(res, { ok: false, error: 'Method not allowed' }, 405)
    return sendJson(res, { ok: true }, 200, { 'Set-Cookie': clearCookieHeader(req) })
  }

  if (url.pathname === '/api/contest') {
    const wantsAdmin = url.searchParams.get('admin') === '1'
    if (wantsAdmin) {
      if (!isAdminRequest(req)) return sendJson(res, { ok: false, unauthorized: true, error: 'Admin login required' }, 401)
      return sendJson(res, await getContest({ isAdmin: true, cacheFile }))
    }
    return sendJson(res, await getContest({ isAdmin: false, cacheFile }))
  }

  if (vite) return vite.middlewares(req, res, () => { res.statusCode = 404; res.end('Not found') })

  const dist = path.join(root, 'dist')
  let file = path.join(dist, path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''))
  if ((file !== dist && !file.startsWith(dist + path.sep)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html')
  if (!fs.existsSync(file)) { res.statusCode = 500; return res.end('Run "npm run build" first (or use "npm start").') }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', ...SEC_HEADERS })
  fs.createReadStream(file).pipe(res)
})

server.listen(PORT, () => {
  console.log(`\n  CF Live Scoreboard`)
  console.log(`  User page   →  http://localhost:${PORT}/`)
  console.log(`  Admin page  →  http://localhost:${PORT}/admin`)
  console.log(`  Contest ${CONTEST} · API key ${HAS_KEY ? 'configured' : 'NOT set (demo data)'} · manager view ${AS_MANAGER ? 'on' : 'off'} · admin password ${isAdminConfigured() ? 'set' : 'NOT set'}\n`)
})
