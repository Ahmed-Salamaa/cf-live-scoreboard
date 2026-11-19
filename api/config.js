export default function handler(_req, res) {
  const contestId = process.env.CF_CONTEST_ID || '732371'
  const hasKey = Boolean(process.env.CF_API_KEY && process.env.CF_API_SECRET)
  const asManager = (process.env.CF_AS_MANAGER ?? 'true') !== 'false'
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  res.statusCode = 200
  res.end(JSON.stringify({ contestId, hasKey, asManager }))
}
