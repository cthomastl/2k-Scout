import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
}

function buildPrompt({ myTeam, opponentTeam, attackTargets, hideTargets, leaveOpen, speedAdvantage, bestMatchups, myKeyPlayers, oppKeyPlayers }) {
  const fmt = lines => lines.length ? lines.join('\n') : '  - No data'

  const attackLines = fmt(attackTargets.map(p =>
    `  - ${p.name} [${(p.positions||[]).join('/')}] (Perimeter Defense ${p.perim} / Interior Defense ${p.interior})`
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
  const myRosterLines = fmt((myKeyPlayers||[]).map(p =>
    `  - ${p.name} [OVR ${p.overall}, ${(p.positions||[]).join('/')}${p.archetype ? ', ' + p.archetype : ''}]`
  ))
  const oppRosterLines = fmt((oppKeyPlayers||[]).map(p =>
    `  - ${p.name} [OVR ${p.overall}, ${(p.positions||[]).join('/')}${p.archetype ? ', ' + p.archetype : ''}]`
  ))

  return `You are an NBA 2K26 expert coach. Your advice is based strictly on 2K attribute ratings — nothing else. Ignore real-life player reputations, history, or tendencies. Only the numbers matter.

You are coaching a human player controlling ${myTeam} against ${opponentTeam}.

MY TEAM — ${myTeam} (top players):
${myRosterLines}

OPPONENT — ${opponentTeam} (top players):
${oppRosterLines}

SCOUTING DATA:

Opponent's weakest defenders — ISO targets:
${attackLines}

My weak perimeter defenders — need to be hidden:
${hideLines}

Opponent's poor shooters — safe to leave open:
${leaveLines}

Speed mismatches in my favor:
${speedLines}

Recommended defensive assignments:
${matchupLines}

COACHING RULES:
1. Base every recommendation strictly on the attribute numbers above. Do not factor in real-life player reputation.
2. For hide matchups: pair each of my weak defenders with one of their poor shooters by name so my guy can sag off and help (e.g. "Guard [their poor shooter] with [my weak defender] so he can sag into the paint").
3. For attack targets: suggest the specific move based on the defender's low rating — drive, post up, pull-up mid, etc.
4. For speed mismatches: suggest how to exploit them in-game (push transition, blow-bys, backdoor cuts).
5. Every sentence must name a player and a specific action. No generic advice.

Write 4 focused sections: Offensive Plan, Defensive Assignments, Speed and Transition, Key In-Game Adjustments. Under 450 words. Plain text only.`
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS' || event.requestContext?.http?.method === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' }
  }

  let body
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body
  } catch {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid JSON body' }) }
  }

  const {
    myTeam, opponentTeam,
    attackTargets = [], hideTargets = [], leaveOpen = [],
    speedAdvantage = [], bestMatchups = [],
    myKeyPlayers = [], oppKeyPlayers = [],
  } = body

  if (!myTeam || !opponentTeam) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'myTeam and opponentTeam are required' }) }
  }

  try {
    const prompt = buildPrompt({ myTeam, opponentTeam, attackTargets, hideTargets, leaveOpen, speedAdvantage, bestMatchups, myKeyPlayers, oppKeyPlayers })

    const message = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1500,
      thinking: { type: 'adaptive' },
      messages: [{ role: 'user', content: prompt }],
    })

    const textBlock = message.content.find(b => b.type === 'text')
    const gamePlan = textBlock?.text ?? 'No game plan generated.'

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ gamePlan }),
    }
  } catch (err) {
    console.error('Claude API error:', err)
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: err.message || 'Failed to generate game plan' }),
    }
  }
}
