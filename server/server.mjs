// Local server: serves the app and proxies signed Codeforces API calls.
// The API secret stays here (read from .env) and never reaches the browser.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { signedUrl, plainUrl } from './sign.mjs'

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
const KEY = process.env.CF_API_KEY || ''
const SECRET = process.env.CF_API_SECRET || ''
const HAS_KEY = Boolean(KEY && SECRET)
const AS_MANAGER = (process.env.CF_AS_MANAGER ?? 'true') !== 'false'
const CACHE_FILE = path.join(root, 'data', `contest-${CONTEST}.json`)
const CACHE_TTL_MS = 5000
const MIN_GAP_MS = 2100 // Codeforces allows 1 request / 2 s

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- Codeforces calls, strictly paced ----
let chain = Promise.resolve()
let lastCall = 0
function cfCall(method, params) {
  const run = async () => {
    const wait = Math.max(0, lastCall + MIN_GAP_MS - Date.now())
    if (wait) await sleep(wait)
    lastCall = Date.now()
    const url = HAS_KEY ? signedUrl(method, params, KEY, SECRET) : plainUrl(method, params)
    const res = await fetch(url)
    const body = await res.json().catch(() => null)
    if (!body || body.status !== 'OK') throw new Error(body?.comment || `HTTP ${res.status}`)
    return body.result
  }
  const p = chain.then(run, run)
  chain = p.catch(() => {})
  return p
}

let warnedManager = false
async function fetchAll() {
  const useManager = AS_MANAGER && HAS_KEY
  const sParams = { contestId: CONTEST, from: '1', count: '100000', showUnofficial: 'false' }
  let managerOk = useManager
  let standings
  try {
    standings = await cfCall('contest.standings', useManager ? { ...sParams, asManager: 'true' } : sParams)
  } catch (e) {
    if (!useManager) throw e
    if (!warnedManager) console.warn(`[warn] asManager request failed (${e.message}); retrying without it. Hidden verdicts may be unavailable.`)
    warnedManager = true
    managerOk = false
    standings = await cfCall('contest.standings', sParams)
  }
  const stParams = { contestId: CONTEST, from: '1', count: '1000000' }
  const submissions = await cfCall('contest.status', managerOk ? { ...stParams, asManager: 'true' } : stParams)
  return { standings, submissions, managerView: managerOk }
}

let cached = null // { at, payload }
let inflight = null
async function getContest() {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.payload
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const data = await fetchAll()
      const payload = { ok: true, source: 'live', fetchedAt: Date.now(), ...data }
      cached = { at: Date.now(), payload }
      fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true })
      fs.writeFileSync(CACHE_FILE, JSON.stringify(payload))
      return payload
    } catch (e) {
      console.warn(`[warn] Codeforces fetch failed: ${e.message}`)
      if (fs.existsSync(CACHE_FILE)) {
        const payload = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'))
        return { ...payload, source: 'cache', error: e.message }
      }
      if (!HAS_KEY) return { ok: false, demo: true, reason: `No API key configured (${e.message})` }
      return { ok: false, error: e.message }
    } finally {
      inflight = null
    }
  })()
  return inflight
}

// ---- HTTP ----
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.map': 'application/json' }

function sendJson(res, obj, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(obj))
}

let vite = null
if (isDev) {
  const { createServer } = await import('vite')
  vite = await createServer({ root, server: { middlewareMode: true }, appType: 'spa' })
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  if (url.pathname === '/api/config') return sendJson(res, { contestId: CONTEST, hasKey: HAS_KEY, asManager: AS_MANAGER })
  if (url.pathname === '/api/contest') return sendJson(res, await getContest())
  if (vite) return vite.middlewares(req, res, () => { res.statusCode = 404; res.end('Not found') })

  const dist = path.join(root, 'dist')
  let file = path.join(dist, path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''))
  if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html')
  if (!fs.existsSync(file)) { res.statusCode = 500; return res.end('Run "npm run build" first (or use "npm start").') }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
})

server.listen(PORT, () => {
  console.log(`\n  CF Live Scoreboard  →  http://localhost:${PORT}`)
  console.log(`  Contest ${CONTEST} · API key ${HAS_KEY ? 'configured' : 'NOT set (demo data will be used)'} · manager view ${AS_MANAGER ? 'on' : 'off'}\n`)
})
