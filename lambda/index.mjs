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

  return `You are an expert NBA 2K strategist. Generate a concise, practical pre-game plan for playing ${myTeam} against ${opponentTeam} in NBA 2K.

SCOUTING DATA:

Opponent's defensive weaknesses — attack these players:
${attackLines}

My defensive liabilities — keep these players off the ball:
${hideLines}

Opponent's poor shooters — sag off to help defend elsewhere:
${leaveLines}

Write a game plan with 3 sections: Offensive Strategy, Defensive Strategy, and Key Adjustments. Be specific — name the players. Keep it under 350 words. Use plain text, no markdown headers.`
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
