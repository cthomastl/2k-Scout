import express from 'express'
import cors from 'cors'
import { createProxyMiddleware } from 'http-proxy-middleware'

const PORT = process.env.PORT || 8080
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://ai-service:3002'
const TEAM_SERVICE_URL = process.env.TEAM_SERVICE_URL || 'http://team-service:3001'
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://auth-service:3003'

const app = express()
app.use(cors())

app.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'ok' })
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
