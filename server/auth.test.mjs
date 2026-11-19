import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { checkLoginRateLimit, clearLoginFailures, hashPassword, recordLoginFailure, signSession, verifyPassword, verifySession } from './auth.mjs'
import { sanitizeForPublic } from './cf.mjs'
import { toSafeAdminSettings } from './settings.mjs'

describe('admin auth', () => {
  const origPass = process.env.ADMIN_PASSWORD
  const origHash = process.env.ADMIN_PASSWORD_HASH
  const origSecret = process.env.CF_API_SECRET

  beforeEach(() => {
    delete process.env.ADMIN_PASSWORD
    process.env.ADMIN_PASSWORD_HASH = hashPassword('super-secret-password')
    process.env.CF_API_SECRET = 'cf-secret'
  })

  afterEach(() => {
    if (origPass === undefined) delete process.env.ADMIN_PASSWORD
    else process.env.ADMIN_PASSWORD = origPass
    if (origHash === undefined) delete process.env.ADMIN_PASSWORD_HASH
    else process.env.ADMIN_PASSWORD_HASH = origHash
    if (origSecret === undefined) delete process.env.CF_API_SECRET
    else process.env.CF_API_SECRET = origSecret
  })

  it('hashes with salted scrypt and verifies password, rejecting wrong/malformed/unconfigured hashes', () => {
    const h1 = hashPassword('same-pass')
    const h2 = hashPassword('same-pass')
    expect(h1.startsWith('scrypt$16384$8$1$')).toBe(true)
    expect(h1).not.toBe(h2) // unique random salt per hash
    expect(verifyPassword('super-secret-password')).toBe(true)
    expect(verifyPassword('wrong')).toBe(false)
    expect(verifyPassword('')).toBe(false)
    process.env.ADMIN_PASSWORD_HASH = 'scrypt$bad$format'
    expect(verifyPassword('super-secret-password')).toBe(false)
    delete process.env.ADMIN_PASSWORD_HASH
    expect(verifyPassword('super-secret-password')).toBe(false)
  })

  it('signs and verifies stateless session tokens and rejects tampered or expired tokens', () => {
    const now = 1700000000
    const token = signSession(now)
    expect(verifySession(token, now + 10)).toBe(true)
    expect(verifySession(token + 'x', now + 10)).toBe(false)
    expect(verifySession(token, now + 60 * 60 * 24)).toBe(false)
  })

  it('rate-limits repeated failed logins per IP and clears on success', () => {
    const ip = '203.0.113.42'
    const now = 1700000000000
    clearLoginFailures(ip)
    for (let i = 0; i < 5; i++) {
      expect(checkLoginRateLimit(ip, now).allowed).toBe(true)
      recordLoginFailure(ip, now)
    }
    const blocked = checkLoginRateLimit(ip, now + 1000)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterSec).toBeGreaterThan(0)
    clearLoginFailures(ip)
    expect(checkLoginRateLimit(ip, now + 1000).allowed).toBe(true)
  })
})

describe('sanitizeForPublic', () => {
  const sample = (phase, freezeDurationSeconds = 3600) => ({
    ok: true,
    source: 'live',
    managerView: true,
    standings: {
      contest: { id: 1, phase, durationSeconds: 18000, freezeDurationSeconds },
      rows: [
        {
          party: { members: [{ handle: 'zoe' }] },
          rank: 1,
          points: 2,
          penalty: 120,
          problemResults: [{ points: 1 }, { points: 1 }],
        },
        {
          party: { members: [{ handle: 'alice' }] },
          rank: 2,
          points: 1,
          penalty: 50,
          problemResults: [{ points: 1 }, { points: 0 }],
        },
      ],
    },
    submissions: [
      { id: 1, author: { members: [{ handle: 'alice' }] }, problem: { index: 'A' }, relativeTimeSeconds: 1000, verdict: 'OK', passedTestCount: 42 },
      { id: 2, author: { members: [{ handle: 'zoe' }] }, problem: { index: 'B' }, relativeTimeSeconds: 15000, verdict: 'OK', passedTestCount: 99, timeConsumedMillis: 123 },
    ],
  })

  it('strips frozen verdicts, passedTestCount, problemResults, rank, and row order during CODING', () => {
    const pub = sanitizeForPublic(sample('CODING'))
    expect(pub.managerView).toBe(false)
    expect(pub.submissions[0].verdict).toBe('OK')
    expect(pub.submissions[1].verdict).toBe('TESTING')
    expect(pub.submissions[1].passedTestCount).toBeUndefined()
    expect(pub.submissions[1].timeConsumedMillis).toBeUndefined()
    // Rows are sorted by party key (alice before zoe), not unfrozen rank (zoe before alice)
    expect(pub.standings.rows.map((r) => r.party.members[0].handle)).toEqual(['alice', 'zoe'])
    expect(pub.standings.rows[0].points).toBe(0)
    expect(pub.standings.rows[0].penalty).toBe(0)
    expect(pub.standings.rows[0].rank).toBeUndefined()
    expect(pub.standings.rows[0].problemResults).toBeUndefined()
  })

  it('defaults to 3600s freeze when freezeDurationSeconds is omitted', () => {
    const pub = sanitizeForPublic(sample('CODING', undefined))
    expect(pub.submissions[1].verdict).toBe('TESTING')
  })

  it('keeps verdicts once contest is FINISHED unless forcePublicFreeze is enabled', () => {
    const pub = sanitizeForPublic(sample('FINISHED'))
    expect(pub.managerView).toBe(false)
    expect(pub.submissions[1].verdict).toBe('OK')
    expect(pub.standings.rows[0].points).toBe(2)

    const forced = sanitizeForPublic(sample('FINISHED'), { forcePublicFreeze: true, freezeMinOverride: 60 })
    expect(forced.submissions[1].verdict).toBe('TESTING')
    expect(forced.standings.rows[0].points).toBe(0)
    expect(forced.standings.contest.freezeDurationSeconds).toBe(3600)
  })
})

describe('toSafeAdminSettings', () => {
  it('never exposes apiKey, apiSecret, or password hashes', () => {
    const safe = toSafeAdminSettings({
      contestId: '732371',
      apiKey: 'pub-key',
      apiSecret: 'top-secret',
      asManager: true,
      freezeMinOverride: 45,
      forcePublicFreeze: true,
      adminPasswordHash: 'scrypt$16384$8$1$aa$bb',
      adminPassword: 'plain',
      storage: 'file',
    })
    expect(safe.hasKey).toBe(true)
    expect(safe.hasSecret).toBe(true)
    expect(safe).not.toHaveProperty('apiKey')
    expect(safe).not.toHaveProperty('apiSecret')
    expect(safe).not.toHaveProperty('adminPasswordHash')
    expect(safe).not.toHaveProperty('adminPassword')
  })
})
