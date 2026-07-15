import express from 'express'
import cors from 'cors'
import morgan from 'morgan'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import pg from 'pg'
import client from 'prom-client'

const PORT = process.env.PORT || 3003
const DEMO_EMAIL = process.env.DEMO_EMAIL || 'scout@2kscout.app'
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'scout2k'
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me'
const DATABASE_URL = process.env.DATABASE_URL

const app = express()
app.use(cors())
app.use(morgan('combined'))
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

function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '7d' })
}

const pool = new pg.Pool({ connectionString: DATABASE_URL })

// Postgres may not be ready the instant this pod starts (no startup ordering
// between Deployments in plain Kubernetes), so retry instead of crashing.
async function initDb() {
  const maxAttempts = 10
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          email TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          name TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `)

      // Seed the documented demo account as a real row, so it keeps working
      // as an ordinary login instead of a hardcoded special case.
      const demoHash = await bcrypt.hash(DEMO_PASSWORD, 10)
      await pool.query(
        `INSERT INTO users (email, password_hash, name)
         VALUES ($1, $2, $3)
         ON CONFLICT (email) DO NOTHING`,
        [DEMO_EMAIL, demoHash, nameFromEmail(DEMO_EMAIL)]
      )

      console.log('auth-service: database ready')
      return
    } catch (err) {
      console.error(`auth-service: database not ready (attempt ${attempt}/${maxAttempts}): ${err.message}`)
      if (attempt === maxAttempts) throw err
      await new Promise(r => setTimeout(r, 2000))
    }
  }
}

app.post('/auth/signup', async (req, res) => {
  const { email, password } = req.body || {}

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' })
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' })
  }

  const normalizedEmail = email.trim().toLowerCase()
  const name = nameFromEmail(normalizedEmail)

  try {
    const passwordHash = await bcrypt.hash(password, 10)
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, $2, $3)
       RETURNING id, email, name`,
      [normalizedEmail, passwordHash, name]
    )
    const user = result.rows[0]
    return res.status(201).json({ token: signToken(user), user })
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'An account with that email already exists' })
    }
    console.error('Signup error:', err)
    return res.status(500).json({ error: 'Failed to create account' })
  }
})

app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body || {}
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' })
  }

  const normalizedEmail = email.trim().toLowerCase()

  try {
    const result = await pool.query(
      'SELECT id, email, name, password_hash FROM users WHERE email = $1',
      [normalizedEmail]
    )
    const row = result.rows[0]
    if (!row || !(await bcrypt.compare(password, row.password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    const user = { id: row.id, email: row.email, name: row.name }
    return res.status(200).json({ token: signToken(user), user })
  } catch (err) {
    console.error('Login error:', err)
    return res.status(500).json({ error: 'Login failed' })
  }
})

app.get('/auth/me', (req, res) => {
  const authHeader = req.headers.authorization || ''
  const match = authHeader.match(/^Bearer\s+(.+)$/i)

  if (!match) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' })
  }

  try {
    const payload = jwt.verify(match[1], JWT_SECRET)
    return res.status(200).json({ user: { id: payload.id, email: payload.email, name: payload.name } })
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
})

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`auth-service listening on ${PORT}`)
    })
  })
  .catch(err => {
    console.error('auth-service: failed to initialize database, exiting', err)
    process.exit(1)
  })
