import express from 'express'
import cors from 'cors'
import jwt from 'jsonwebtoken'
import client from 'prom-client'

const PORT = process.env.PORT || 3003
const DEMO_EMAIL = process.env.DEMO_EMAIL || 'scout@2kscout.app'
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'scout2k'
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me'

const app = express()
app.use(cors())
app.use(express.json())

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

function nameFromEmail(email) {
  return (email || '').split('@')[0]
}

app.post('/auth/login', (req, res) => {
  const { email, password } = req.body || {}

  if (email !== DEMO_EMAIL || password !== DEMO_PASSWORD) {
    return res.status(401).json({ error: 'Invalid credentials' })
  }

  const name = nameFromEmail(email)
  const token = jwt.sign({ email, name }, JWT_SECRET, { expiresIn: '7d' })

  return res.status(200).json({ token, user: { email, name } })
})

app.get('/auth/me', (req, res) => {
  const authHeader = req.headers.authorization || ''
  const match = authHeader.match(/^Bearer\s+(.+)$/i)

  if (!match) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' })
  }

  try {
    const payload = jwt.verify(match[1], JWT_SECRET)
    return res.status(200).json({ user: { email: payload.email, name: payload.name } })
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
})

app.listen(PORT, () => {
  console.log(`auth-service listening on ${PORT}`)
})
