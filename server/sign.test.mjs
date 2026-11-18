import { test, expect } from 'vitest'
import crypto from 'node:crypto'
import { signedUrl } from './sign.mjs'

test('signedUrl sorts params and signs with rand + sha512', () => {
  const url = signedUrl('contest.status', { contestId: '1', from: '1', count: '5' }, 'KEY', 'SECRET', 1700000000, 'abc123')
  const u = new URL(url)
  expect(u.searchParams.get('apiKey')).toBe('KEY')
  expect(u.searchParams.get('time')).toBe('1700000000')
  const expected = crypto
    .createHash('sha512')
    .update('abc123/contest.status?apiKey=KEY&contestId=1&count=5&from=1&time=1700000000#SECRET')
    .digest('hex')
  expect(u.searchParams.get('apiSig')).toBe('abc123' + expected)
  expect(url).not.toContain('SECRET')
})
