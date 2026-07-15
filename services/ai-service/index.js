import express from 'express'
import cors from 'cors'
import morgan from 'morgan'
import Anthropic from '@anthropic-ai/sdk'
import promClient from 'prom-client'
import jwt from 'jsonwebtoken'
import pg from 'pg'
import { createClient } from 'redis'

const PORT = process.env.PORT || 3002
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me'
const DATABASE_URL = process.env.DATABASE_URL
const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379'
const GAMEPLAN_CACHE_TTL_SECONDS = 6 * 60 * 60 // 6 hours — roster/attribute data doesn't change minute to minute

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const app = express()
app.use(cors())
app.use(morgan('combined'))
app.use(express.json({ limit: '1mb' }))

const register = new promClient.Registry()
promClient.collectDefaultMetrics({ register })

const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
})

const cacheHits = new promClient.Counter({
  name: 'cache_hits_total',
  help: 'Number of gameplan requests served from the Redis cache',
  registers: [register],
})

const cacheMisses = new promClient.Counter({
  name: 'cache_misses_total',
  help: 'Number of gameplan requests that missed the Redis cache and called Claude',
  registers: [register],
})

// --- AI-specific metrics — a generic HTTP request/error/latency histogram
// tells you nothing about cost or output quality, and both matter for an
// LLM-backed endpoint the way they never do for a normal CRUD route. ---

const aiTokensTotal = new promClient.Counter({
  name: 'ai_tokens_total',
  help: 'Total tokens consumed by Claude calls, by direction',
  labelNames: ['direction'], // 'input' | 'output'
  registers: [register],
})

// Illustrative per-million-token pricing for claude-opus-4-8 — update if the
// model or its pricing changes. This is for relative cost tracking/alerting
// (“spend is trending up”), not meant to reconcile exactly against the
// Anthropic invoice.
const PRICE_PER_MILLION_INPUT_TOKENS_USD = 15
const PRICE_PER_MILLION_OUTPUT_TOKENS_USD = 75

const aiEstimatedCostUsdTotal = new promClient.Counter({
  name: 'ai_estimated_cost_usd_total',
  help: 'Estimated cumulative USD spend on Claude calls (see pricing constants in source — approximate, not billing-accurate)',
  registers: [register],
})

const anthropicRequestDuration = new promClient.Histogram({
  name: 'anthropic_request_duration_seconds',
  help: 'Duration of the Claude API call specifically, isolated from DB writes and cache checks in the same request',
  buckets: [0.5, 1, 2, 4, 8, 16, 32],
  registers: [register],
})

const aiStopReasonTotal = new promClient.Counter({
  name: 'ai_stop_reason_total',
  help: 'Claude responses by stop_reason — max_tokens means a truncated answer that still returns HTTP 200',
  labelNames: ['reason'],
  registers: [register],
})

const aiErrorsTotal = new promClient.Counter({
  name: 'ai_errors_total',
  help: 'Claude call failures by category — different categories need different responses (back off vs check API key vs our own bug)',
  labelNames: ['type'],
  registers: [register],
})

function classifyAnthropicError(err) {
  const status = err?.status
  if (status === 429) return 'rate_limit'
  if (status === 529) return 'overloaded'
  if (status === 401 || status === 403) return 'auth'
  if (status === 400) return 'invalid_request'
  if (status >= 500) return 'anthropic_server_error'
  return 'other'
}

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

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || ''
  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  if (!match) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' })
  }
  try {
    req.user = jwt.verify(match[1], JWT_SECRET)
    next()
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
}

const pool = new pg.Pool({ connectionString: DATABASE_URL })

async function initDb() {
  const maxAttempts = 10
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS gameplans (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL,
          team_a TEXT NOT NULL,
          team_b TEXT NOT NULL,
          generated_text TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `)
      await pool.query(`
        CREATE TABLE IF NOT EXISTS usage_events (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL,
          event_type TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `)
      console.log('ai-service: database ready')
      return
    } catch (err) {
      console.error(`ai-service: database not ready (attempt ${attempt}/${maxAttempts}): ${err.message}`)
      if (attempt === maxAttempts) throw err
      await new Promise(r => setTimeout(r, 2000))
    }
  }
}

const redis = createClient({ url: REDIS_URL })
redis.on('error', err => console.error('Redis error:', err.message))

function gameplanCacheKey(myTeam, opponentTeam) {
  return `gameplan:v1:${myTeam}::${opponentTeam}`
}

function buildPrompt({ myTeam, opponentTeam, attackTargets, hideTargets, leaveOpen, speedAdvantage, bestMatchups, myKeyPlayers, oppKeyPlayers, opponentStrategy }) {
  const fmt = lines => lines.length ? lines.join('\n') : '  - No data'

  const attackLines = fmt(attackTargets.map(p =>
    `  - ${p.name} [${(p.positions||[]).join('/')}] Per. Def ${p.perim} / Int. Def ${p.interior} → ${p.attackHint}`
  ))
  const hideLines = fmt(hideTargets.map(p =>
    `  - ${p.name} (Perimeter Defense ${p.perim})`
  ))
  const leaveLines = fmt(leaveOpen.map(p =>
    `  - ${p.name} (Three-Point Shot ${p.three} / Mid-Range ${p.mid})`
  ))
  const speedLines = fmt((speedAdvantage||[]).map(m =>
    `  - ${m.myPlayer} (Speed ${m.mySpeed}) vs ${m.oppPlayer} (Speed ${m.oppSpeed}) — advantage +${m.diff}`
  ))
  const matchupLines = fmt((bestMatchups||[]).map(m =>
    `  - ${m.threat} [OVR ${m.threatOverall}, ${m.threatPos}${m.threatArchetype ? ', ' + m.threatArchetype : ''}] → guard with ${m.defender} (${m.statLabel} ${m.defValue})`
  ))
  const myRosterLines = fmt((myKeyPlayers||[]).map(p => {
    const badgeStr = p.badges?.length ? ` | Badges: ${p.badges.join(', ')}` : ''
    return `  - ${p.name} [OVR ${p.overall}, ${(p.positions||[]).join('/')}${p.archetype ? ', ' + p.archetype : ''}]${badgeStr}`
  }))
  const oppRosterLines = fmt((oppKeyPlayers||[]).map(p => {
    const badgeStr = p.badges?.length ? ` | Badges: ${p.badges.join(', ')}` : ''
    return `  - ${p.name} [OVR ${p.overall}, ${(p.positions||[]).join('/')}${p.archetype ? ', ' + p.archetype : ''}]${badgeStr}`
  }))

  const strategySection = opponentStrategy
    ? `\nOPPONENT'S LIKELY OFFENSIVE STRATEGY (user-provided):\n  ${opponentStrategy}\nYour defensive plan must specifically counter this strategy.\n`
    : ''

  return `You are an NBA 2K26 expert coach. Your advice is based strictly on 2K attribute ratings and 2K gameplay mechanics — nothing else. Only the numbers and badges matter.

You are coaching a human player controlling ${myTeam} against ${opponentTeam}.

IMPORTANT: Build your entire game plan around the STARTING FIVE only. Do not mention bench players.

MY STARTING FIVE — ${myTeam}:
${myRosterLines}

OPPONENT'S STARTING FIVE — ${opponentTeam}:
${oppRosterLines}

--- 2K STAT DEFINITIONS (use these to reason correctly) ---
Perimeter Defense: guards the arc and mid-range. Low PD on a BIG means they cannot guard on the perimeter — exploit by pulling them AWAY from the paint with a stretch player, NOT by driving into them. Low PD on a GUARD/WING means drive/ISO directly at them.
Interior Defense: protects the paint. Low ID on any player means attack them in the paint — post up, drive into them, attack the basket against them.
---

SCOUTING DATA:

Attack targets (each entry includes how to exploit them based on their position and which stat is weak):
${attackLines}

My weak perimeter defenders to hide:
${hideLines}

Opponent's poor shooters — safe to leave open:
${leaveLines}

Speed mismatches in my favor:
${speedLines}

Defensive assignments:
${matchupLines}
${strategySection}
--- 2K DEFENSIVE SETTINGS REFERENCE ---
On-Ball Pressure: Tight = stay glued to ball-handler (good vs fast guards), Gap = allow space to cut off drive (good vs poor shooters)
Screen Defense: Go Over = fight over top of screen (stops 3PT shooters), Go Under = drop behind screen (stops drive, concedes jump shot), Switch = eliminates screen, risks size mismatches
Hedge: Hard Hedge = big steps out aggressively to contain ball-handler, Soft Hedge = brief contain then drop back, Drop = big drops to protect paint immediately (best vs non-shooting bigs), Switch = full switch
Double Team Post: Manual = never auto-double, On Catch = double as soon as they receive in post, On Dribble = double when they put it on the floor, Always = constant double
Drive Help: Help = off-ball defenders drop to paint on drives (risks open corner 3s), No Help = defenders stay on shooters
Post Defense: Behind = guard behind post player (weak, gives easy catch), Three-Quarter Top = deny entry from above, Three-Quarter Bottom = deny from below (best for strong post players), Front = full front (requires help from weak side)
---

COACHING RULES:
1. For attack targets: follow the attackHint exactly — do NOT suggest driving at a big with low PD, suggest pulling them OUT to the perimeter instead. Only suggest driving/posting when the attackHint says so.
2. For hide matchups: each hidden defender has ONE assignment for the entire game — their designated poor shooter. Do not give them any secondary assignments, rotations, or mention them covering any other player anywhere in the game plan.
3. "Leave open" list only includes players with genuinely poor shooting (3PT < 78 AND mid < 80). If this list is empty or short, assume the opponent's perimeter players CAN shoot — do NOT recommend sagging off them or recommending Drive Help unless the list is populated.
4. For speed mismatches: name the specific in-game action (push transition, backdoor cut, blow-by on wing).
5. For defensive settings: pick specific values for On-Ball Pressure, Screen Defense, Hedge, Double Team Post, and Drive Help. One line each, name the reason.
6. Every bullet must name a player and a specific action. No generic advice.

Format: 5 sections with short bullet points (•). Max 4 bullets per section. Max 1 sentence per bullet. Total under 350 words. Plain text only.`
}

app.post('/api/gameplan', requireAuth, async (req, res) => {
  const body = req.body || {}

  const {
    myTeam, opponentTeam,
    attackTargets = [], hideTargets = [], leaveOpen = [],
    speedAdvantage = [], bestMatchups = [],
    myKeyPlayers = [], oppKeyPlayers = [],
    opponentStrategy = '',
  } = body

  if (!myTeam || !opponentTeam) {
    return res.status(400).json({ error: 'myTeam and opponentTeam are required' })
  }

  const cacheKey = gameplanCacheKey(myTeam, opponentTeam)

  try {
    const cached = await redis.get(cacheKey)
    if (cached) {
      cacheHits.inc()
      await pool.query(
        'INSERT INTO usage_events (user_id, event_type) VALUES ($1, $2)',
        [req.user.id, 'gameplan_cache_hit']
      )
      return res.status(200).json({ gamePlan: cached, cached: true })
    }
  } catch (err) {
    console.error('Redis read error (continuing without cache):', err.message)
  }

  cacheMisses.inc()

  try {
    const prompt = buildPrompt({ myTeam, opponentTeam, attackTargets, hideTargets, leaveOpen, speedAdvantage, bestMatchups, myKeyPlayers, oppKeyPlayers, opponentStrategy })

    const endAnthropicTimer = anthropicRequestDuration.startTimer()
    let message
    try {
      message = await anthropic.messages.create({
        model: 'claude-opus-4-8',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      })
    } catch (err) {
      aiErrorsTotal.inc({ type: classifyAnthropicError(err) })
      throw err
    } finally {
      endAnthropicTimer()
    }

    const inputTokens = message.usage?.input_tokens ?? 0
    const outputTokens = message.usage?.output_tokens ?? 0
    aiTokensTotal.inc({ direction: 'input' }, inputTokens)
    aiTokensTotal.inc({ direction: 'output' }, outputTokens)
    aiEstimatedCostUsdTotal.inc(
      (inputTokens / 1_000_000) * PRICE_PER_MILLION_INPUT_TOKENS_USD +
      (outputTokens / 1_000_000) * PRICE_PER_MILLION_OUTPUT_TOKENS_USD
    )
    aiStopReasonTotal.inc({ reason: message.stop_reason || 'unknown' })

    const textBlock = message.content.find(b => b.type === 'text')
    if (!textBlock) throw new Error('No text block in Claude response')
    const gamePlan = textBlock.text

    try {
      await redis.setEx(cacheKey, GAMEPLAN_CACHE_TTL_SECONDS, gamePlan)
    } catch (err) {
      console.error('Redis write error (continuing without cache):', err.message)
    }

    await pool.query(
      `INSERT INTO gameplans (user_id, team_a, team_b, generated_text) VALUES ($1, $2, $3, $4)`,
      [req.user.id, myTeam, opponentTeam, gamePlan]
    )
    await pool.query(
      'INSERT INTO usage_events (user_id, event_type) VALUES ($1, $2)',
      [req.user.id, 'gameplan_generated']
    )

    return res.status(200).json({ gamePlan, cached: false })
  } catch (err) {
    console.error('Claude API error:', err)
    return res.status(500).json({ error: err.message || 'Failed to generate game plan' })
  }
})

app.get('/api/gameplan/history', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, team_a, team_b, generated_text, created_at
       FROM gameplans
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [req.user.id]
    )
    return res.status(200).json({ gameplans: result.rows })
  } catch (err) {
    console.error('History fetch error:', err)
    return res.status(500).json({ error: 'Failed to load history' })
  }
})

// Redis is a nice-to-have cache, not a hard dependency — both the read and
// write around it above already fall back to "just call Claude" on error, so
// it shouldn't block startup the way Postgres (required for saving history
// and usage events on every request) does.
redis.connect().catch(err => console.error('ai-service: Redis connect failed, starting without cache:', err.message))

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`ai-service listening on ${PORT}`)
    })
  })
  .catch(err => {
    console.error('ai-service: failed to initialize database, exiting', err)
    process.exit(1)
  })
