import express from 'express'
import cors from 'cors'
import morgan from 'morgan'
import { createProxyMiddleware } from 'http-proxy-middleware'
import client from 'prom-client'

const PORT = process.env.PORT || 8080
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://ai-service:3002'
const TEAM_SERVICE_URL = process.env.TEAM_SERVICE_URL || 'http://team-service:3001'
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://auth-service:3003'

const app = express()
app.use(cors())
// Same combined format nginx (frontend) logs in by default — one
// consistent, greppable log shape across every pod in Loki instead of
// frontend being the only service with per-request logs.
app.use(morgan('combined'))

const register = new client.Registry()
client.collectDefaultMetrics({ register })

const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
})

// Backend metrics can't see what happens purely in the browser — a JS
// exception in the matchup-rendering logic, or a slow-to-interactive page
// load, never touches any backend endpoint at all. The gateway is the
// front door, so it's the natural place to receive these beacons rather
// than standing up a separate collector.
const frontendJsErrors = new client.Counter({
  name: 'frontend_js_errors_total',
  help: 'Uncaught JS errors and unhandled promise rejections reported by the frontend',
  registers: [register],
})

const frontendTimeToInteractive = new client.Histogram({
  name: 'frontend_time_to_interactive_seconds',
  help: 'Time from navigation start to the app finishing its first render (an approximation of TTI, not the strict web-vitals metric)',
  buckets: [0.5, 1, 2, 3, 5, 8, 13],
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

// Under /api/ so the Ingress (which only routes /api and /auth to gateway —
// everything else falls to the frontend nginx pod) actually delivers it
// here, rather than a bare /client-metrics 404ing against the SPA. Handled
// directly, not proxied — must be registered before the generic /api proxy
// below so Express's own route matches first instead of forwarding this to
// team-service.
//
// express.json() is scoped to just this route, not applied globally — the
// proxy middlewares below need the raw, unconsumed request body to forward
// POST /api/gameplan and /auth/login correctly. A global body parser would
// drain those bodies before http-proxy-middleware ever sees them.
app.post('/api/client-metrics', express.json({ limit: '10kb' }), (req, res) => {
  const { type, value } = req.body || {}
  if (type === 'js_error') {
    frontendJsErrors.inc()
  } else if (type === 'tti' && typeof value === 'number') {
    frontendTimeToInteractive.observe(value)
  }
  // 204: the browser sends this via sendBeacon/fetch and never looks at the
  // response — no reason to make it wait on a body.
  res.status(204).end()
})

// Proxies are mounted WITHOUT an Express path prefix and instead select requests
// with `pathFilter`. This preserves the full original path (e.g. /api/teams) when
// forwarding — Express mount paths would strip the prefix and break the upstream
// services, which all route on their full paths (/api/*, /auth/*).
//
// Order matters: the more specific /api/gameplan filter is registered before the
// generic /api filter so game-plan requests reach ai-service, not team-service.
const isGamePlan = path => path === '/api/gameplan' || path.startsWith('/api/gameplan/')

app.use(createProxyMiddleware({
  pathFilter: isGamePlan,
  target: AI_SERVICE_URL,
  changeOrigin: true,
}))

app.use(createProxyMiddleware({
  pathFilter: path => path.startsWith('/api') && !isGamePlan(path),
  target: TEAM_SERVICE_URL,
  changeOrigin: true,
}))

app.use(createProxyMiddleware({
  pathFilter: path => path.startsWith('/auth'),
  target: AUTH_SERVICE_URL,
  changeOrigin: true,
}))

app.listen(PORT, () => {
  console.log(`gateway listening on ${PORT}`)
})
