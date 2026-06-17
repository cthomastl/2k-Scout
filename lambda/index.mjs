import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
}

function buildPrompt({ myTeam, opponentTeam, attackTargets, hideTargets, leaveOpen }) {
  const attackLines = attackTargets.length
    ? attackTargets.map(p => `  - ${p.name} (PD ${p.perim} / ID ${p.interior})`).join('\n')
    : '  - No data available'

  const hideLines = hideTargets.length
    ? hideTargets.map(p => `  - ${p.name} (PD ${p.perim})`).join('\n')
    : '  - No data available'

  const leaveLines = leaveOpen.length
    ? leaveOpen.map(p => `  - ${p.name} (3PT ${p.three} / MID ${p.mid})`).join('\n')
    : '  - No data available'

  return `You are an expert NBA 2K coach giving pre-game instructions to a human player controlling ${myTeam} against ${opponentTeam}.

SCOUTING DATA:

${opponentTeam} defensive weaknesses (low PD = easy to score on in isolation):
${attackLines}

${myTeam} defensive liabilities (low PD = get beaten off the dribble, exploit by opponent):
${hideLines}

${opponentTeam} poor shooters (low 3PT + mid = safe to leave open, sag off for help defense):
${leaveLines}

IMPORTANT STRATEGY RULES — follow these exactly:
- "Hide" means: pair each of MY weak defenders with one of THEIR poor shooters so MY weak defender can sag off and help on drives instead of being isolated. Name the specific pairing (e.g. "Guard [their poor shooter] with [my weak defender] so [my weak defender] can sag into the paint").
- "Attack" means: run ISO plays or post-ups targeting the opponent's worst defenders. Name who to attack and what move to use (drive, post, mid pull-up).
- Never suggest putting a weak offensive player in an isolation role.
- Be tactical, specific, and concise. No generic advice.

Write 3 short sections: Offensive Plan, Defensive Matchups, Key Adjustments. Under 300 words. Plain text only.`
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

  const { myTeam, opponentTeam, attackTargets = [], hideTargets = [], leaveOpen = [] } = body

  if (!myTeam || !opponentTeam) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'myTeam and opponentTeam are required' }) }
  }

  try {
    const prompt = buildPrompt({ myTeam, opponentTeam, attackTargets, hideTargets, leaveOpen })

    const message = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1024,
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
