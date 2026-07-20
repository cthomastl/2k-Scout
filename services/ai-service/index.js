import express from 'express'
import cors from 'cors'
import Anthropic from '@anthropic-ai/sdk'

const PORT = process.env.PORT || 3002

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const app = express()
app.use(cors())
app.use(express.json({ limit: '1mb' }))

app.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'ok' })
})

function buildPrompt({
  myTeam, opponentTeam, attackTargets, hideTargets, leaveOpen, speedAdvantage, bestMatchups,
  myKeyPlayers, oppKeyPlayers, opponentStrategy,
  pnrGuidance, theirAttackTargets, theirHideTargets, myPlayersLeftOpen, theirSpeedAdvantage, topDefenders,
  lineups,
}) {
  const fmt = lines => lines.length ? lines.join('\n') : '  - No data'
  // hideTargets/attackTargets/theirAttackTargets/theirHideTargets carry `badges` as raw
  // {name, tier} objects (not the pre-formatted strings myKeyPlayers/oppKeyPlayers use).
  const badgeNote = p => (p.badges?.length ? ` — badged up (${p.badges.map(b => b.name).join(', ')})` : '')

  const attackLines = fmt(attackTargets.map(p =>
    `  - ${p.name} [${(p.positions||[]).join('/')}] Per. Def ${p.perim} / Int. Def ${p.interior} → ${p.attackHint}`
  ))
  const hideLines = fmt(hideTargets.map(p =>
    `  - ${p.name} (Perimeter Defense ${p.perim})${badgeNote(p)}`
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
    const benchStr = p.bench ? ' (bench)' : ''
    return `  - ${p.name} [OVR ${p.overall}, ${(p.positions||[]).join('/')}${p.archetype ? ', ' + p.archetype : ''}]${benchStr}${badgeStr}`
  }))
  const oppRosterLines = fmt((oppKeyPlayers||[]).map(p => {
    const badgeStr = p.badges?.length ? ` | Badges: ${p.badges.join(', ')}` : ''
    const benchStr = p.bench ? ' (bench)' : ''
    return `  - ${p.name} [OVR ${p.overall}, ${(p.positions||[]).join('/')}${p.archetype ? ', ' + p.archetype : ''}]${benchStr}${badgeStr}`
  }))

  const lineupLines = fmt((lineups||[]).map(l =>
    `  - ${l.name} (${l.desc}): ${(l.players||[]).join(', ')}`
  ))

  const pnrLines = fmt((pnrGuidance||[]).map(g =>
    `  - ${g.big} vs ${g.handler}'s ball screens (set by ${g.screener}) → ${g.coverage}. ${g.reason}`
  ))
  const theirAttackLines = fmt((theirAttackTargets||[]).map(p =>
    `  - ${p.name} [${(p.positions||[]).join('/')}] Per. Def ${p.perim} / Int. Def ${p.interior}${badgeNote(p)}`
  ))
  const theirHideLines = fmt((theirHideTargets||[]).map(p =>
    `  - ${p.name} (Perimeter Defense ${p.perim})${badgeNote(p)} — their weak defender, hunt this matchup`
  ))
  const myLeftOpenLines = fmt((myPlayersLeftOpen||[]).map(p =>
    `  - ${p.name} (Three-Point Shot ${p.three} / Mid-Range ${p.mid}) — they will sag off him`
  ))
  const theirSpeedLines = fmt((theirSpeedAdvantage||[]).map(m =>
    `  - ${m.theirPlayer} (Speed ${m.theirSpeed}) vs ${m.myPlayer} (Speed ${m.mySpeed}) — their advantage +${m.diff}`
  ))
  const bestDefenderLines = fmt([
    ...(topDefenders?.lockdownPerimeter||[]).map(p => `  - ${p.name} (Perimeter Defense ${p.perim}) — best available perimeter lockdown, may be a bench piece`),
    ...(topDefenders?.paintDefenders||[]).map(p => `  - ${p.name} (Interior Defense ${p.interior}) — best available rim protector, may be a bench piece`),
  ])

  const strategySection = opponentStrategy
    ? `\nOPPONENT'S LIKELY OFFENSIVE STRATEGY (user-provided):\n  ${opponentStrategy}\nYour defensive plan must specifically counter this strategy.\n`
    : ''

  return `You are an NBA 2K26 expert coach. Your advice is based strictly on 2K attribute ratings and 2K gameplay mechanics — nothing else. Only the numbers and badges matter.

You are coaching a human player controlling ${myTeam} against ${opponentTeam}. This is a tough opponent — assume they will exploit any mismatch you leave on the floor and use their full rotation, not just their starters.

Build your game plan around the primary rotation below. Prioritize the starters for on-court assignments, but name a bench player by name when it's specifically relevant (e.g., a defensive substitution to bring in against a particular threat).

MY ROTATION — ${myTeam}:
${myRosterLines}

OPPONENT'S ROTATION — ${opponentTeam}:
${oppRosterLines}

My best available defenders (may include bench pieces — call them in when relevant):
${bestDefenderLines}

LINEUP OPTIONS (already computed — reference these by name, do not invent other lineups):
${lineupLines}

--- 2K STAT DEFINITIONS (use these to reason correctly) ---
Perimeter Defense: guards the arc and mid-range. Low PD on a BIG means they cannot guard on the perimeter — exploit by pulling them AWAY from the paint with a stretch player, NOT by driving into them. Low PD on a GUARD/WING means drive/ISO directly at them.
Interior Defense: protects the paint. Low ID on any player means attack them in the paint — post up, drive into them, attack the basket against them.
---

SCOUTING DATA — MY OFFENSE / DEFENSE AGAINST THEM:

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

Pick-and-roll coverage (already computed — use these exact calls, do not invent different coverage):
${pnrLines}

THEIR LIKELY GAME PLAN AGAINST ME (use this to proactively warn the user):

Weak links on my roster they will attack:
${theirAttackLines}

Their weak defenders they will try to hide — I should hunt these matchups:
${theirHideLines}

My players they will leave open / sag off:
${myLeftOpenLines}

Their speed advantages over my matched defenders:
${theirSpeedLines}
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
5. For pick-and-roll coverage: use the exact calls provided — do not invent alternate coverage for those bigs.
6. For "their game plan against me": call out by name which of my players will get hunted, which of their players I should specifically attack because they'll try to hide him, and which of my players they'll sag off — do not just repeat my own attack targets.
7. For defensive settings: pick specific values for On-Ball Pressure, Screen Defense, Hedge, Double Team Post, and Drive Help. One line each, name the reason.
8. "Badged up" next to a player means his defensive badges make him tougher than his raw rating alone suggests — treat him with more caution than the number implies, and don't call him an easy target without acknowledging the badges.
9. For situational lineups: use the exact 3 lineups provided (Best Overall, Best Defensive, Best 3PT) — do not invent a different lineup. Tie each one to a specific in-game situation (protecting a late lead, need a defensive stop, trailing and need to erase a deficit fast, foul trouble on a starter, opponent going small/big).
10. For substitution tips: name at least 2 specific bench players from MY ROTATION (marked "(bench)") and the exact situation to bring each one in — fatigue on a starter, foul trouble, a specific matchup from "My best available defenders", or a change in the opponent's approach. Do not suggest a substitution for a player not listed in my rotation.
11. Every bullet must name a player and a specific action. No generic advice.

Format: 7 sections with short bullet points (•): Offensive Attack Plan, Defensive Assignments, Pick-and-Roll Coverage, Protect Against Their Game Plan, Defensive Settings, Situational Lineups, Substitution Tips. Max 4 bullets per section (Situational Lineups and Substitution Tips can use 3). Max 1 sentence per bullet. Total under 600 words. Plain text only.`
}

app.post('/api/gameplan', async (req, res) => {
  const body = req.body || {}

  const {
    myTeam, opponentTeam,
    attackTargets = [], hideTargets = [], leaveOpen = [],
    speedAdvantage = [], bestMatchups = [],
    myKeyPlayers = [], oppKeyPlayers = [],
    opponentStrategy = '',
    pnrGuidance = [],
    theirAttackTargets = [], theirHideTargets = [], myPlayersLeftOpen = [], theirSpeedAdvantage = [],
    topDefenders = {},
    lineups = [],
  } = body

  if (!myTeam || !opponentTeam) {
    return res.status(400).json({ error: 'myTeam and opponentTeam are required' })
  }

  try {
    const prompt = buildPrompt({
      myTeam, opponentTeam, attackTargets, hideTargets, leaveOpen, speedAdvantage, bestMatchups,
      myKeyPlayers, oppKeyPlayers, opponentStrategy,
      pnrGuidance, theirAttackTargets, theirHideTargets, myPlayersLeftOpen, theirSpeedAdvantage, topDefenders,
      lineups,
    })

    const message = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 2800,
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
