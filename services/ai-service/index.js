import express from 'express'
import cors from 'cors'
import Anthropic from '@anthropic-ai/sdk'
import promClient from 'prom-client'

const PORT = process.env.PORT || 3002

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const app = express()
app.use(cors())
app.use(express.json({ limit: '1mb' }))

const register = new promClient.Registry()
promClient.collectDefaultMetrics({ register })

const httpRequestDuration = new promClient.Histogram({
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

app.post('/api/gameplan', async (req, res) => {
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

  try {
    const prompt = buildPrompt({ myTeam, opponentTeam, attackTargets, hideTargets, leaveOpen, speedAdvantage, bestMatchups, myKeyPlayers, oppKeyPlayers, opponentStrategy })

    const message = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    })

    const textBlock = message.content.find(b => b.type === 'text')
    if (!textBlock) throw new Error('No text block in Claude response')
    const gamePlan = textBlock.text

    return res.status(200).json({ gamePlan })
  } catch (err) {
    console.error('Claude API error:', err)
    return res.status(500).json({ error: err.message || 'Failed to generate game plan' })
  }
})

app.listen(PORT, () => {
  console.log(`ai-service listening on ${PORT}`)
})
