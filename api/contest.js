import { signedUrl, plainUrl } from '../server/sign.mjs'

const CACHE_TTL_MS = 5000
const MIN_GAP_MS = 2100 // Codeforces allows 1 request / 2 s

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let chain = Promise.resolve()
let lastCall = 0
function cfCall(method, params, key, secret) {
  const hasKey = Boolean(key && secret)
  const run = async () => {
    const wait = Math.max(0, lastCall + MIN_GAP_MS - Date.now())
    if (wait) await sleep(wait)
    lastCall = Date.now()
    const url = hasKey ? signedUrl(method, params, key, secret) : plainUrl(method, params)
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
async function fetchAll(contestId, key, secret, asManager) {
  const hasKey = Boolean(key && secret)
  const useManager = asManager && hasKey
  const sParams = { contestId, from: '1', count: '100000', showUnofficial: 'false' }
  let managerOk = useManager
  let standings
  try {
    standings = await cfCall('contest.standings', useManager ? { ...sParams, asManager: 'true' } : sParams, key, secret)
  } catch (e) {
    if (!useManager) throw e
    if (!warnedManager) console.warn(`[warn] asManager request failed (${e.message}); retrying without it. Hidden verdicts may be unavailable.`)
    warnedManager = true
    managerOk = false
    standings = await cfCall('contest.standings', sParams, key, secret)
  }
  const stParams = { contestId, from: '1', count: '1000000' }
  const submissions = await cfCall('contest.status', managerOk ? { ...stParams, asManager: 'true' } : stParams, key, secret)
  return { standings, submissions, managerView: managerOk }
}

let cached = null // { at, contestId, payload }
let inflight = null

async function getContest() {
  const contestId = process.env.CF_CONTEST_ID || '732371'
  const key = process.env.CF_API_KEY || ''
  const secret = process.env.CF_API_SECRET || ''
  const hasKey = Boolean(key && secret)
  const asManager = (process.env.CF_AS_MANAGER ?? 'true') !== 'false'

  if (cached && cached.contestId === contestId && Date.now() - cached.at < CACHE_TTL_MS) return cached.payload
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const data = await fetchAll(contestId, key, secret, asManager)
      const payload = { ok: true, source: 'live', fetchedAt: Date.now(), ...data }
      cached = { at: Date.now(), contestId, payload }
      return payload
    } catch (e) {
      console.warn(`[warn] Codeforces fetch failed: ${e.message}`)
      if (cached && cached.contestId === contestId) {
        return { ...cached.payload, source: 'cache', error: e.message }
      }
      if (!hasKey) return { ok: false, demo: true, reason: `No API key configured (${e.message})` }
      return { ok: false, error: e.message }
    } finally {
      inflight = null
    }
  })()
  return inflight
}

export default async function handler(_req, res) {
  const payload = await getContest()
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', payload.ok && payload.source === 'live' ? 'public, s-maxage=5, stale-while-revalidate=10' : 'no-store')
  res.statusCode = 200
  res.end(JSON.stringify(payload))
}
