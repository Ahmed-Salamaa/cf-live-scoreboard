import crypto from 'node:crypto'

/**
 * Build a signed Codeforces API URL.
 * apiSig = rand(6) + sha512Hex(`${rand}/${method}?${sortedParams}#${secret}`)
 * where sortedParams includes apiKey and time, sorted by parameter name.
 */
export function signedUrl(method, params, key, secret, nowSec = Math.floor(Date.now() / 1000), rand = crypto.randomBytes(3).toString('hex')) {
  const all = { ...params, apiKey: key, time: String(nowSec) }
  const names = Object.keys(all).sort()
  const raw = names.map((k) => `${k}=${all[k]}`).join('&')
  const hash = crypto.createHash('sha512').update(`${rand}/${method}?${raw}#${secret}`).digest('hex')
  const qs = names.map((k) => `${k}=${encodeURIComponent(all[k])}`).join('&')
  return `https://codeforces.com/api/${method}?${qs}&apiSig=${rand}${hash}`
}

export function plainUrl(method, params) {
  const qs = Object.keys(params)
    .sort()
    .map((k) => `${k}=${encodeURIComponent(params[k])}`)
    .join('&')
  return `https://codeforces.com/api/${method}?${qs}`
}
