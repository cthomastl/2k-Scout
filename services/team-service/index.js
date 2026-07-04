import express from 'express'
import cors from 'cors'
import client from 'prom-client'

const PORT = process.env.PORT || 3001
const UPSTREAM = 'https://api.nba2kapi.com'
const API_KEY = process.env.NBA2K_API_KEY || ''
const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

const app = express()
app.use(cors())

const register = new client.Registry()
client.collectDefaultMetrics({ register })

const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
})

app.use((req, res, next) => {
  const end = httpRequestDuration.startTimer()
  res.on('finish', () => {
    end({ method: req.method, route: req.path, status_code: res.statusCode })
  })
  next()
})

app.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'ok' })
})

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType)
  res.end(await register.metrics())
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
