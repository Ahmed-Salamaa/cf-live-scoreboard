import fs from 'node:fs'
import path from 'node:path'
import { signedUrl, plainUrl } from './sign.mjs'
import { getSettings } from './settings.mjs'

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

/**
 * Strip hidden verdicts, per-problem results, ranks, and official totals from public
 * (non-admin) responses while the contest is frozen so hidden results cannot leak.
 */
export function sanitizeForPublic(payload, settings = {}) {
  if (!payload || !payload.ok || !payload.standings) return payload
  const c = payload.standings.contest
  const isFinished = c?.phase === 'FINISHED'
  const forceFreeze = Boolean(settings?.forcePublicFreeze)
  const freezeSec =
    typeof settings?.freezeMinOverride === 'number'
      ? settings.freezeMinOverride * 60
      : typeof c?.freezeDurationSeconds === 'number'
        ? c.freezeDurationSeconds
        : 3600
  const contestOut =
    typeof settings?.freezeMinOverride === 'number'
      ? { ...c, freezeDurationSeconds: freezeSec }
      : c
  const shouldHide = (!isFinished || forceFreeze) && freezeSec > 0 && typeof c?.durationSeconds === 'number'
  if (!shouldHide) {
    return { ...payload, managerView: false, standings: { ...payload.standings, contest: contestOut } }
  }
  const freezeAt = c.durationSeconds - freezeSec
  const submissions = (payload.submissions ?? []).map((s) =>
    s.relativeTimeSeconds >= freezeAt
      ? { id: s.id, author: s.author, problem: s.problem, relativeTimeSeconds: s.relativeTimeSeconds, verdict: 'TESTING' }
      : s,
  )
  const partySortKey = (p) => (p?.teamId != null ? `t${p.teamId}` : (p?.members ?? []).map((m) => m.handle).join('+'))
  const rows = (payload.standings.rows ?? [])
    .map((r) => ({ party: r.party, points: 0, penalty: 0 }))
    .sort((a, b) => partySortKey(a.party).localeCompare(partySortKey(b.party)))
  return {
    ...payload,
    managerView: false,
    standings: { ...payload.standings, contest: contestOut, rows },
    submissions,
  }
}

let cached = null // { at, cacheKey, payload }
let inflight = null

export function invalidateContestCache() {
  cached = null
  warnedManager = false
}

async function getRawContest(settings, cacheDir) {
  const { contestId, apiKey: key, apiSecret: secret, asManager } = settings
  const hasKey = Boolean(key && secret)
  const cacheKey = `${contestId}:${key}:${asManager}`
  const cacheFile = cacheDir ? path.join(cacheDir, `contest-${contestId}.json`) : null

  if (cached && cached.cacheKey === cacheKey && Date.now() - cached.at < CACHE_TTL_MS) return cached.payload
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const data = await fetchAll(contestId, key, secret, asManager)
      const payload = { ok: true, source: 'live', fetchedAt: Date.now(), ...data }
      cached = { at: Date.now(), cacheKey, payload }
      if (cacheFile) {
        try {
          fs.mkdirSync(path.dirname(cacheFile), { recursive: true })
          fs.writeFileSync(cacheFile, JSON.stringify(payload))
        } catch {
          /* ignore read-only fs */
        }
      }
      return payload
    } catch (e) {
      console.warn(`[warn] Codeforces fetch failed: ${e.message}`)
      if (cached && cached.cacheKey === cacheKey) {
        return { ...cached.payload, source: 'cache', error: e.message }
      }
      if (cacheFile && fs.existsSync(cacheFile)) {
        const payload = JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
        return { ...payload, source: 'cache', error: e.message }
      }
      if (!hasKey) return { ok: false, demo: true, reason: `No API key configured (${e.message})` }
      return { ok: false, error: e.message }
    } finally {
      inflight = null
    }
  })()
  return inflight
}

export async function getContest({ isAdmin = false, cacheDir = null, settings = null } = {}) {
  const s = settings ?? (await getSettings())
  const raw = await getRawContest(s, cacheDir)
  if (isAdmin) {
    if (raw.ok && raw.standings && typeof s.freezeMinOverride === 'number') {
      return {
        ...raw,
        standings: { ...raw.standings, contest: { ...raw.standings.contest, freezeDurationSeconds: s.freezeMinOverride * 60 } },
      }
    }
    return raw
  }
  return sanitizeForPublic(raw, s)
}
