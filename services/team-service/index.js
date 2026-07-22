import express from 'express'
import cors from 'cors'
import { metricsMiddleware } from './metrics.js'

const PORT = process.env.PORT || 3001
const UPSTREAM = 'https://api.nba2kapi.com'
const API_KEY = process.env.NBA2K_API_KEY || ''
const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

const app = express()
app.use(cors())
app.use(metricsMiddleware('team-service'))

app.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'ok' })
})

// In-memory cache keyed by full path + query string.
const cache = new Map()

function getCached(key) {
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    cache.delete(key)
    return null
  }
  return entry.data
}

function setCached(key, data) {
  cache.set(key, { at: Date.now(), data })
}

// Generic proxy: forward GET /api/* to https://api.nba2kapi.com/api/* with the
// server-side API key header. Caches the JSON response for 1 hour.
app.get('/api/*', async (req, res) => {
  const key = req.originalUrl // full path + query string

  const cached = getCached(key)
  if (cached !== null) {
    return res.status(200).json(cached)
  }

  const upstreamUrl = `${UPSTREAM}${req.originalUrl}`

  try {
    const upstreamRes = await fetch(upstreamUrl, {
      method: 'GET',
      headers: {
        'X-API-Key': API_KEY,
        Accept: 'application/json',
      },
    })

    if (!upstreamRes.ok) {
      const text = await upstreamRes.text()
      return res.status(upstreamRes.status).json({
        error: `Upstream error ${upstreamRes.status}`,
        detail: text,
      })
    }

    const data = await upstreamRes.json()
    setCached(key, data)
    return res.status(200).json(data)
  } catch (err) {
    console.error('Proxy error:', err)
    return res.status(502).json({ error: err.message || 'Upstream request failed' })
  }
})

app.listen(PORT, () => {
  console.log(`team-service listening on ${PORT}`)
})
