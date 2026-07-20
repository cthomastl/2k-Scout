import express from 'express'
import cors from 'cors'
import morgan from 'morgan'
import client from 'prom-client'
import { createClient } from 'redis'

const PORT = process.env.PORT || 3001
const UPSTREAM = 'https://api.nba2kapi.com'
const API_KEY = process.env.NBA2K_API_KEY || ''
const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379'
const CACHE_TTL_SECONDS = 60 * 60 // 1 hour

const app = express()
app.use(cors())
app.use(morgan('combined'))

const register = new client.Registry()
client.collectDefaultMetrics({ register })

const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
})

const cacheHits = new client.Counter({
  name: 'cache_hits_total',
  help: 'Number of requests served from the Redis cache',
  registers: [register],
})

const cacheMisses = new client.Counter({
  name: 'cache_misses_total',
  help: 'Number of requests that missed the Redis cache and hit nba2kapi.com',
  registers: [register],
})

// A cache hit rate alone can't tell you if you're serving stale data — this
// tracks how old a served cache entry actually was, independent of whether
// it "worked." 2K ratings do change across patches, so a healthy hit rate
// with a climbing age is a real (silent) problem: correct-looking responses
// that are quietly out of date.
const cacheEntryAge = new client.Histogram({
  name: 'cache_entry_age_seconds',
  help: 'Age of a cache entry at the time it was served (time since it was fetched from nba2kapi.com)',
  buckets: [1, 10, 60, 300, 900, 1800, 3600],
  registers: [register],
})

// Isolated from this service's own http_request_duration_seconds status
// codes on purpose — the same principle as ai-service's ai_errors_total:
// "nba2kapi is down" and "we have a bug" need different responses, and a
// blended error rate can't tell them apart.
const upstreamRequests = new client.Counter({
  name: 'nba2kapi_upstream_requests_total',
  help: 'Requests to api.nba2kapi.com by outcome',
  labelNames: ['outcome'], // 'success' | 'error'
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

// Shared cache across every team-service replica, keyed by full path + query
// string. Previously an in-memory Map — that meant each replica had its own
// separate cache (diluting the hit rate across replicas) and lost everything
// on every pod restart. Redis fixes both.
const redis = createClient({ url: REDIS_URL })
redis.on('error', err => console.error('Redis error:', err.message))

// Generic proxy: forward GET /api/* to https://api.nba2kapi.com/api/* with the
// server-side API key header. Caches the JSON response for 1 hour.
app.get('/api/*', async (req, res) => {
  const key = `team-service:${req.originalUrl}` // full path + query string

  try {
    const cached = await redis.get(key)
    if (cached !== null) {
      cacheHits.inc()
      const { cachedAt, data } = JSON.parse(cached)
      cacheEntryAge.observe((Date.now() - cachedAt) / 1000)
      return res.status(200).json(data)
    }
  } catch (err) {
    console.error('Redis read error (continuing without cache):', err.message)
  }

  cacheMisses.inc()

  const upstreamUrl = `${UPSTREAM}${req.originalUrl}`
  const upstreamStart = Date.now()

  try {
    const upstreamRes = await fetch(upstreamUrl, {
      method: 'GET',
      headers: {
        'X-API-Key': API_KEY,
        Accept: 'application/json',
      },
    })
    const upstreamMs = Date.now() - upstreamStart

    if (!upstreamRes.ok) {
      const text = await upstreamRes.text()
      upstreamRequests.inc({ outcome: 'error' })
      console.error(`nba2kapi upstream error: GET ${req.originalUrl} -> ${upstreamRes.status} (${upstreamMs}ms)`)
      return res.status(upstreamRes.status).json({
        error: `Upstream error ${upstreamRes.status}`,
        detail: text,
      })
    }

    upstreamRequests.inc({ outcome: 'success' })
    console.log(`nba2kapi upstream: GET ${req.originalUrl} -> ${upstreamRes.status} (${upstreamMs}ms)`)
    const data = await upstreamRes.json()
    try {
      await redis.setEx(key, CACHE_TTL_SECONDS, JSON.stringify({ cachedAt: Date.now(), data }))
    } catch (err) {
      console.error('Redis write error (continuing without cache):', err.message)
    }
    return res.status(200).json(data)
  } catch (err) {
    upstreamRequests.inc({ outcome: 'error' })
    console.error('Proxy error:', err)
    return res.status(502).json({ error: err.message || 'Upstream request failed' })
  }
})

// Caching is a nice-to-have, not a hard dependency — every cache operation
// above already falls back to "just hit the upstream API" on a Redis error,
// so a slow/unavailable Redis at startup shouldn't block this service from
// serving traffic at all.
redis.connect().catch(err => console.error('team-service: Redis connect failed, starting without cache:', err.message))

app.listen(PORT, () => {
  console.log(`team-service listening on ${PORT}`)
})
