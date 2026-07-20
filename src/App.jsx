import { useState, useEffect } from 'react'
import './App.css'

const API_KEY = import.meta.env.VITE_NBA2K_API_KEY ?? ''
const BASE_URL = ''
const LAMBDA_URL = import.meta.env.VITE_LAMBDA_URL ?? ''
// In the Kubernetes deployment the ingress routes /api/gameplan to the AI service.
// Fall back to the standalone Lambda URL when one is configured (legacy / local dev).
const GAMEPLAN_URL = LAMBDA_URL || '/api/gameplan'
const AUTH_BASE = import.meta.env.VITE_AUTH_BASE ?? '/auth'
const DEMO_EMAIL = 'scout@2kscout.app'
const DEMO_PASSWORD = 'scout2k'

async function apiFetch(path) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'X-API-Key': API_KEY },
  })
  if (!res.ok) throw new Error(`API error ${res.status}: ${res.statusText}`)
  return res.json()
}

/* ── Icons (inline SVG — no emoji) ── */
const Icon = ({ path, size = 18, stroke = 1.7, fill = 'none' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor"
    strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {path}
  </svg>
)
const IconDashboard = p => <Icon {...p} path={<><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></>} />
const IconScout = p => <Icon {...p} path={<><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></>} />
const IconRankings = p => <Icon {...p} path={<><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></>} />
const IconSettings = p => <Icon {...p} path={<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></>} />
const IconLogout = p => <Icon {...p} path={<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></>} />
const IconSun = p => <Icon {...p} path={<><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></>} />
const IconMoon = p => <Icon {...p} path={<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>} />
const IconUsers = p => <Icon {...p} path={<><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>} />
const IconTarget = p => <Icon {...p} path={<><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></>} />
const IconBolt = p => <Icon {...p} path={<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>} />
const IconShield = p => <Icon {...p} path={<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>} />
const IconArrowRight = p => <Icon {...p} path={<><path d="M5 12h14M12 5l7 7-7 7"/></>} />

function getRatingColor(val) {
  const n = parseInt(val, 10)
  if (isNaN(n)) return '#9ca3af'
  if (n >= 90) return '#22c55e'
  if (n >= 75) return '#eab308'
  return '#ef4444'
}

function getBadgeTierColor(tier) {
  if (!tier) return '#9ca3af'
  const t = tier.toLowerCase()
  if (t === 'legendary') return '#a855f7'
  if (t === 'hall of fame' || t === 'hof') return '#f59e0b'
  if (t === 'gold') return '#eab308'
  if (t === 'silver') return '#94a3b8'
  if (t === 'bronze') return '#b45309'
  return '#9ca3af'
}

function getBadgeTierLabel(tier) {
  if (!tier) return tier
  const t = tier.toLowerCase()
  if (t === 'hall of fame' || t === 'hof') return 'HoF'
  if (t === 'legendary') return 'Legend'
  return tier.charAt(0).toUpperCase() + tier.slice(1)
}

const PERIMETER = ['PG', 'SG', 'SF']
const BIGS = ['C', 'PF']
const ROTATION_SIZE = 8

function isPerimeterPlayer(p) { return (p.positions || []).some(pos => PERIMETER.includes(pos)) }
function isBigPlayer(p) { return (p.positions || []).some(pos => BIGS.includes(pos)) }
function topByOverall(roster, n) {
  return [...roster].filter(p => p.attributes).sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0)).slice(0, n)
}

// Fills PG/SG/SF/PF/C from a pool ranked by scoreFn, one player per slot, no repeats.
function pickPositionalLineup(pool, scoreFn) {
  const sorted = [...pool].sort((a, b) => scoreFn(b) - scoreFn(a))
  const slots = ['PG', 'SG', 'SF', 'PF', 'C']
  const used = new Set()
  const result = []
  for (const slot of slots) {
    const match = sorted.find(p => !used.has(p.name) && (p.positions || []).includes(slot))
    if (match) { used.add(match.name); result.push(match) }
  }
  for (const p of sorted) {
    if (result.length >= 5) break
    if (!used.has(p.name)) { used.add(p.name); result.push(p) }
  }
  return result
}

// A raw Perimeter/Interior Defense number doesn't tell the whole story — a player with a mediocre
// rating but Clamps/Glove/Pick Dodger at Gold+ can still lock up a quick guard, while a "weak"
// number with no badges is a genuine target. These catalogs + the score/chip helpers below let
// every defense-rating-driven computation (attack targets, hide targets, best defenders) account
// for badges instead of the raw number alone.
const PERIMETER_DEFENSE_BADGES = [
  'clamps', 'glove', 'interceptor', 'pick dodger', 'chase down artist',
  'ankle braces', 'off-ball pest', 'challenger', 'high-flying denier', 'intimidator',
]
const PAINT_DEFENSE_BADGES = [
  'rim protector', 'paint patroller', 'post lockdown', 'brick wall',
  'boxout beast', 'rebound chaser', 'high-flying denier', 'intimidator',
]
const BADGE_TIER_WEIGHT = { legendary: 5, 'hall of fame': 4, hof: 4, gold: 3, silver: 2, bronze: 1 }
function badgeTierWeight(tier) { return BADGE_TIER_WEIGHT[(tier || '').toLowerCase()] ?? 0 }

function matchedDefensiveBadges(player, badgeCatalog) {
  return dedupeByName(player.badges?.list ?? [])
    .filter(b => badgeCatalog.includes((b.name || '').toLowerCase()))
    .sort((a, b) => badgeTierWeight(b.tier) - badgeTierWeight(a.tier))
}

// Points added to a raw defense rating per matched badge, scaled so a single Gold badge (≈15pts)
// or HOF (≈20pts) meaningfully moves a player up the list — comparable to a real attribute edge.
function defensiveBadgeScore(player, badgeCatalog) {
  return matchedDefensiveBadges(player, badgeCatalog).reduce((sum, b) => sum + badgeTierWeight(b.tier) * 5, 0)
}

// Computes what `attackRoster` should do against `defendRoster`: attack targets on defendRoster,
// attackRoster's own weak perimeter defenders to hide, defendRoster's poor shooters to leave open,
// and attackRoster's perimeter speed edges. Calling this with (opponent, mine) instead of (mine, opponent)
// yields the opponent's likely game plan against you, since the logic is fully symmetric.
function computeScoutingReport(attackRoster, defendRoster, n = ROTATION_SIZE) {
  const attackers = topByOverall(attackRoster, n)
  const targets = topByOverall(defendRoster, n)

  const attackTargets = targets
    .map(p => {
      const pos = p.positions || []
      const isB = isBigPlayer(p)
      const perim = p.attributes.perimeterDefense ?? 99
      const interior = p.attributes.interiorDefense ?? 99
      // A weak raw rating can be misleading if the player is badged up — Clamps/Glove/Pick Dodger
      // etc. push the *effective* difficulty back up even though the number alone looks soft.
      const perimBadges = matchedDefensiveBadges(p, PERIMETER_DEFENSE_BADGES)
      const interiorBadges = matchedDefensiveBadges(p, PAINT_DEFENSE_BADGES)
      const perimEffective = perim + defensiveBadgeScore(p, PERIMETER_DEFENSE_BADGES)
      const interiorEffective = interior + defensiveBadgeScore(p, PAINT_DEFENSE_BADGES)
      const badges = dedupeByName([...perimBadges, ...interiorBadges])
      let attackHint
      if (isB) {
        attackHint = perim <= interior
          ? 'stretch big — low PD means cannot guard on perimeter; use a shooter to pull them away from the paint'
          : 'paint target — low interior defense; post up or attack the basket against them'
      } else {
        // A guard/wing can be a target for either reason — don't always blame perimeter defense
        // when his real weakness is interior defense (post him up / attack the rim instead).
        attackHint = perim <= interior
          ? 'ISO/drive target — low perimeter defense; blow past them on the wing or in isolation'
          : 'small-ball post target — solid on the perimeter but weak interior defense; back him down or attack the rim rather than trying to blow by him'
      }
      if (badges.length > 0) {
        attackHint += ` — badged up (${badges.map(b => b.name).join(', ')}), tougher than the raw rating suggests`
      }
      return {
        name: p.name, archetype: p.archetype, positions: pos, perim, interior, attackHint,
        badges, badged: badges.length > 0,
        effectiveRating: perimEffective + interiorEffective,
      }
    })
    .sort((a, b) => a.effectiveRating - b.effectiveRating)
    .slice(0, 3)

  const hideTargets = attackers
    .filter(isPerimeterPlayer)
    .map(p => {
      const perim = p.attributes.perimeterDefense ?? 99
      const badges = matchedDefensiveBadges(p, PERIMETER_DEFENSE_BADGES)
      return {
        name: p.name, archetype: p.archetype, perim,
        badges, badged: badges.length > 0,
        effectiveRating: perim + defensiveBadgeScore(p, PERIMETER_DEFENSE_BADGES),
      }
    })
    .sort((a, b) => a.effectiveRating - b.effectiveRating)
    .slice(0, 3)

  const leaveOpen = targets
    .filter(isPerimeterPlayer)
    .map(p => ({
      name: p.name,
      archetype: p.archetype,
      three: p.attributes.threePointShot ?? 99,
      mid: p.attributes.midRangeShot ?? 99,
    }))
    .filter(p => p.three < 80)
    .sort((a, b) => (a.three + a.mid) - (b.three + b.mid))
    .slice(0, 3)

  const speedAdvantage = attackers
    .filter(isPerimeterPlayer)
    .map(attackerP => {
      const attackerPos = attackerP.positions || []
      const targetMatch = targets
        .filter(p => (p.positions || []).some(pos => attackerPos.includes(pos)))
        .sort((a, b) => (a.attributes.speed ?? 0) - (b.attributes.speed ?? 0))[0]
      if (!targetMatch) return null
      const diff = (attackerP.attributes.speed ?? 0) - (targetMatch.attributes.speed ?? 0)
      return diff >= 8 ? {
        attackerPlayer: attackerP.name,
        attackerSpeed: attackerP.attributes.speed,
        targetPlayer: targetMatch.name,
        targetSpeed: targetMatch.attributes.speed,
        diff,
      } : null
    })
    .filter(Boolean)
    .sort((a, b) => b.diff - a.diff)
    .slice(0, 3)

  return { attackTargets, hideTargets, leaveOpen, speedAdvantage }
}

// Best individual defenders across the FULL roster (not just the rotation) — a reference for
// specialist matchups even when the player isn't a top-8 overall piece.
function computeBestDefenders(roster) {
  const withAttrs = roster.filter(p => p.attributes)

  // A high Perimeter Defense number alone doesn't guarantee he can stay in front of a quick
  // guard — a slow-footed defender still gets beat off the dribble. Agility (speed + acceleration)
  // and defensive badges (Clamps, Glove, Pick Dodger, etc.) both factor into who actually belongs
  // at the top of this list.
  const lockdownPerimeter = withAttrs
    .filter(isPerimeterPlayer)
    .map(p => {
      const agility = ((p.attributes.speed ?? 0) + (p.attributes.acceleration ?? 0)) / 2
      const badges = matchedDefensiveBadges(p, PERIMETER_DEFENSE_BADGES)
      const badgeScore = defensiveBadgeScore(p, PERIMETER_DEFENSE_BADGES)
      return {
        name: p.name, overall: p.overall, archetype: p.archetype, positions: p.positions,
        perim: p.attributes.perimeterDefense ?? 0, steal: p.attributes.steal ?? 0,
        speed: p.attributes.speed ?? 0, agility, badges,
        score: (p.attributes.perimeterDefense ?? 0) + (p.attributes.steal ?? 0) * 0.3 + agility * 0.4 + badgeScore,
      }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)

  const paintDefenders = withAttrs
    .filter(isBigPlayer)
    .map(p => {
      const badges = matchedDefensiveBadges(p, PAINT_DEFENSE_BADGES)
      const badgeScore = defensiveBadgeScore(p, PAINT_DEFENSE_BADGES)
      return {
        name: p.name, overall: p.overall, archetype: p.archetype, positions: p.positions,
        interior: p.attributes.interiorDefense ?? 0, block: p.attributes.block ?? 0, badges,
        score: (p.attributes.interiorDefense ?? 0) + (p.attributes.block ?? 0) * 0.3 + badgeScore,
      }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)

  return { lockdownPerimeter, paintDefenders }
}

// Recommends ball-screen coverage for up to two (my big, their ball-handler, their screener)
// combos — not just a single handler vs. a single big. Reasons from the screener's pop/lob/pass
// threat as well as the handler's pull-up threat, and gates Switch on the big's own Perimeter
// Defense (not raw speed) since that's the stat that actually determines whether he survives
// being switched onto a guard.
function computePnRGuidance(myRoster, oppRoster) {
  const withAttrs = r => r.filter(p => p.attributes)

  const myBigs = withAttrs(myRoster)
    .filter(isBigPlayer)
    .sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0))
    .slice(0, 2)

  const ballHandlers = withAttrs(oppRoster)
    .filter(p => (p.positions || []).some(pos => ['PG', 'SG'].includes(pos)))
    .map(p => ({
      ...p,
      handleScore: (p.attributes.ballHandle ?? 0) * 0.4 + (p.attributes.speed ?? 0) * 0.3 + (p.attributes.acceleration ?? 0) * 0.3,
    }))
    .sort((a, b) => b.handleScore - a.handleScore)
    .slice(0, 2)

  // Screeners: the opponent's top bigs, paired 1:1 with their top ball-handlers as the two most
  // likely starting screen actions. We don't have real play-calling data, so this is a proxy —
  // but it's a real improvement over ignoring the screener entirely.
  const screeners = withAttrs(oppRoster)
    .filter(isBigPlayer)
    .sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0))
    .slice(0, 2)

  if (!myBigs.length || !ballHandlers.length || !screeners.length) return []

  const pairCount = Math.min(myBigs.length, ballHandlers.length)

  return Array.from({ length: pairCount }, (_, i) => {
    const big = myBigs[i]
    const handler = ballHandlers[i] ?? ballHandlers[0]
    const screener = screeners[i] ?? screeners[0]

    const pullUpThreat = Math.max(handler.attributes.threePointShot ?? 0, handler.attributes.midRangeShot ?? 0)
    const rimProtection = ((big.attributes.interiorDefense ?? 0) + (big.attributes.block ?? 0)) / 2
    // Switchability is gated on the big's own Perimeter Defense — the stat that measures whether
    // he can actually contain a guard in space — not on raw speed/acceleration.
    const switchability = big.attributes.perimeterDefense ?? 0
    const hedgeRecovery = ((big.attributes.speed ?? 0) + (big.attributes.acceleration ?? 0)) / 2
    const screenerPopThreat = screener.attributes.threePointShot ?? 0
    const screenerLobThreat = ((screener.attributes.vertical ?? 0) + (screener.attributes.closeShot ?? 0)) / 2
    const screenerPassAccuracy = screener.attributes.passAccuracy ?? 0

    let coverage, reason
    if (screenerPopThreat >= 78) {
      // A stretch screener makes Drop unsafe regardless of the handler's own shooting — dropping
      // leaves the screener wide open on the pop.
      if (switchability >= 75) {
        coverage = 'Switch'
        reason = `${screener.name} can pop for three (${screenerPopThreat} rated) — Drop leaves him wide open, so switch the screen with ${big.name} and live with the resulting matchup.`
      } else if (hedgeRecovery >= 70) {
        coverage = 'Hard Hedge'
        reason = `${screener.name} can pop for three (${screenerPopThreat} rated), so Drop isn't safe — hedge hard with ${big.name} on ${handler.name} and closeout to the screener as he pops.`
      } else {
        coverage = 'Go Under'
        reason = `${screener.name} can pop for three and ${big.name} can't switch or hedge and recover in time — go under and live with a contested pull-up rather than risk a blown closeout on the screener.`
      }
    } else if (pullUpThreat >= 85) {
      if (switchability >= 75) {
        coverage = 'Switch'
        reason = `${handler.name} is a lethal pull-up shooter (${pullUpThreat} rated) — switch the screen with ${big.name} to take away the jumper entirely.`
      } else if (hedgeRecovery >= 70) {
        coverage = 'Hard Hedge'
        reason = `${handler.name} is a lethal pull-up shooter (${pullUpThreat} rated) — hedge hard with ${big.name} to force the ball out of his hands before he can rise into it.`
      } else {
        coverage = 'Go Under'
        reason = `${handler.name} is a lethal pull-up shooter and ${big.name} can't switch (weak Perimeter Defense) or hedge effectively — go under and funnel him toward help instead of risking a mismatch.`
      }
    } else if (rimProtection >= 80) {
      coverage = 'Drop'
      reason = `${big.name} protects the rim (Int. Def/Block avg ${Math.round(rimProtection)}) and ${handler.name} isn't a real shooting threat (${pullUpThreat} rated) — drop and dare the pull-up.`
      if (screenerLobThreat >= 85) {
        reason += ` Stay alert for the lob — ${screener.name} finishes above the rim.`
      }
    } else if (hedgeRecovery >= 75) {
      coverage = 'Soft Hedge'
      reason = `${big.name} has the mobility (avg ${Math.round(hedgeRecovery)}) to hedge and recover without opening an easy roll.`
    } else {
      coverage = 'Go Under'
      reason = `${big.name} lacks rim protection and mobility — keep the guard going under the screen rather than put ${big.name} in space.`
    }

    // Short-roll passing is the SCREENER's read after diving to the elbow, not the handler's kick-out passing.
    if (screenerPassAccuracy >= 85 && coverage !== 'Switch') {
      reason += ` Watch the short roll — ${screener.name} passes well off the catch (${screenerPassAccuracy} rating).`
    }

    return { big: big.name, handler: handler.name, screener: screener.name, coverage, reason }
  })
}

function computeMatchupEdges(myRoster, oppRoster) {
  const PERIM = ['PG', 'SG', 'SF']
  const BIGS  = ['C', 'PF']
  const withAttrs = r => r.filter(p => p.attributes)
  const top5  = r => [...withAttrs(r)].sort((a, b) => (b.overall??0) - (a.overall??0)).slice(0, 5)
  const avg   = (arr, fn) => {
    const vals = arr.map(fn).filter(v => v > 0)
    return vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : 0
  }
  const perim = r => withAttrs(r).filter(p => (p.positions||[]).some(pos => PERIM.includes(pos)))
  const bigs  = r => withAttrs(r).filter(p => (p.positions||[]).some(pos => BIGS.includes(pos)))

  return [
    { label: 'Top 5 OVR',    my: avg(top5(myRoster),   p => p.overall ?? 0),                        opp: avg(top5(oppRoster),   p => p.overall ?? 0) },
    { label: 'Speed',         my: avg(perim(myRoster),  p => p.attributes.speed ?? 0),               opp: avg(perim(oppRoster),  p => p.attributes.speed ?? 0) },
    { label: 'Perimeter Def', my: avg(top5(myRoster),   p => p.attributes.perimeterDefense ?? 0),    opp: avg(top5(oppRoster),   p => p.attributes.perimeterDefense ?? 0) },
    { label: 'Interior Def',  my: avg(bigs(myRoster).length ? bigs(myRoster) : top5(myRoster),  p => p.attributes.interiorDefense ?? 0), opp: avg(bigs(oppRoster).length ? bigs(oppRoster) : top5(oppRoster), p => p.attributes.interiorDefense ?? 0) },
    { label: '3PT Shooting',  my: avg(perim(myRoster),  p => p.attributes.threePointShot ?? 0),      opp: avg(perim(oppRoster),  p => p.attributes.threePointShot ?? 0) },
  ]
}

function DefBadgeChips({ badges }) {
  if (!badges || badges.length === 0) return null
  return (
    <div className="badge-player-chips" style={{ marginTop: 4 }}>
      {badges.map((b, j) => (
        <span key={j} className="badge-chip small" style={{ borderColor: getBadgeTierColor(b.tier), color: getBadgeTierColor(b.tier) }}>
          {b.name} · {getBadgeTierLabel(b.tier)}
        </span>
      ))}
    </div>
  )
}

function Spinner({ small, label, center }) {
  return (
    <div className={`spinner-wrap${center ? ' center-loading' : ''}`}>
      <div className={`spinner${small ? ' spinner-sm' : ''}`} />
      {label && <span>{label}</span>}
    </div>
  )
}

function StatRow({ label, value }) {
  return (
    <div className="stat-row">
      <span className="stat-label">{label}</span>
      <span className="stat-value" style={{ color: getRatingColor(value) }}>
        {value ?? '—'}
      </span>
    </div>
  )
}

function StatGroup({ title, stats, playerData }) {
  return (
    <div className="stat-group">
      <div className="stat-group-title">{title}</div>
      {stats.map(({ label, key }) => (
        <StatRow key={key} label={label} value={playerData[key]} />
      ))}
    </div>
  )
}

const OFFENSE_STATS = [
  { label: 'Close Shot', key: 'closeShot' },
  { label: 'Mid Range', key: 'midRangeShot' },
  { label: 'Three Point', key: 'threePointShot' },
  { label: 'Ball Handle', key: 'ballHandle' },
  { label: 'Passing', key: 'passAccuracy' },
]

const DEFENSE_STATS = [
  { label: 'Perimeter Def', key: 'perimeterDefense' },
  { label: 'Interior Def', key: 'interiorDefense' },
  { label: 'Steal', key: 'steal' },
  { label: 'Block', key: 'block' },
]

const ATHLETIC_STATS = [
  { label: 'Speed', key: 'speed' },
  { label: 'Acceleration', key: 'acceleration' },
  { label: 'Strength', key: 'strength' },
  { label: 'Vertical', key: 'vertical' },
]

function BadgeList({ badges }) {
  if (!Array.isArray(badges) || badges.length === 0) {
    return <p className="badge-unavailable">No badges.</p>
  }

  // API returns each badge twice — deduplicate by name
  const seen = new Set()
  const unique = badges.filter(b => {
    if (seen.has(b.name)) return false
    seen.add(b.name)
    return true
  })

  const tierOrder = ['legendary', 'hall of fame', 'gold', 'silver', 'bronze']
  const sorted = [...unique].sort((a, b) => {
    const ia = tierOrder.findIndex(t => (a.tier || '').toLowerCase().includes(t))
    const ib = tierOrder.findIndex(t => (b.tier || '').toLowerCase().includes(t))
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
  })

  return (
    <div className="badge-list">
      {sorted.map((badge, i) => (
        <span
          key={i}
          className="badge-chip"
          style={{ borderColor: getBadgeTierColor(badge.tier), color: getBadgeTierColor(badge.tier) }}
        >
          {badge.name}
          {badge.tier && <span className="badge-tier"> · {getBadgeTierLabel(badge.tier)}</span>}
        </span>
      ))}
    </div>
  )
}

function PlayerCard({ player, teamName }) {
  const [expanded, setExpanded] = useState(false)
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const slug = player.slug || player.name?.toLowerCase().replace(/\s+/g, '-')

  async function handleExpand() {
    if (expanded) {
      setExpanded(false)
      return
    }
    setExpanded(true)
    if (detail) return
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch(`/api/players/slug/${slug}?teamType=allt&team=${encodeURIComponent(teamName)}`)
      console.log(`Player detail for ${player.name}:`, JSON.stringify(res, null, 2))
      const data = res.data ?? res
      setDetail(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const overall = player.overall ?? detail?.overall

  return (
    <div className={`player-card ${expanded ? 'expanded' : ''}`}>
      <button className="player-card-header" onClick={handleExpand} aria-expanded={expanded}>
        <span className="player-name">{player.name}</span>
        <span className="player-meta">
          {player.positions && <span className="player-pos">{Array.isArray(player.positions) ? player.positions[0] : player.positions}</span>}
          {overall && (
            <span className="player-overall" style={{ color: getRatingColor(overall) }}>
              {overall}
            </span>
          )}
        </span>
        <span className="expand-arrow">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="player-card-body">
          {loading && <div className="loading">Loading player data…</div>}
          {error && <div className="api-error">Error: {error}</div>}
          {detail && !loading && (
            <div className="player-detail">
              {detail.playerImage && (
                <img
                  className="player-headshot"
                  src={detail.playerImage}
                  alt={detail.name}
                  onError={e => { e.target.style.display = 'none' }}
                />
              )}
              <div className="player-header-info">
                <div className="player-detail-name">{detail.name}</div>
                <div className="player-detail-meta">
                  {detail.positions && <span>{Array.isArray(detail.positions) ? detail.positions.join(' / ') : detail.positions}</span>}
                  {detail.overall && (
                    <span style={{ color: getRatingColor(detail.overall) }}>
                      OVR {detail.overall}
                    </span>
                  )}
                </div>
              </div>

              <div className="stats-grid">
                <StatGroup title="Offense" stats={OFFENSE_STATS} playerData={detail.attributes || {}} />
                <StatGroup title="Defense" stats={DEFENSE_STATS} playerData={detail.attributes || {}} />
                <StatGroup title="Athletic" stats={ATHLETIC_STATS} playerData={detail.attributes || {}} />
              </div>

              <div className="badges-section">
                <div className="badges-title">Badges</div>
                <BadgeList badges={detail.badges?.list ?? []} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function TeamPanel({ side, selectedTeam, onTeamChange, teams, roster, loading, error }) {
  const label = side === 'my' ? 'My Team' : "Opponent's Team"

  return (
    <div className={`team-panel team-panel--${side}`}>
      <div className="panel-header">
        <h2>{label}</h2>
        <select
          className="team-select"
          value={selectedTeam}
          onChange={e => onTeamChange(e.target.value)}
        >
          <option value="">— Select Team —</option>
          {teams.map(t => (
            <option key={t.teamName} value={t.teamName}>
              {t.teamName}
            </option>
          ))}
        </select>
      </div>

      {loading && <Spinner small label="Loading roster…" />}
      {error && <div className="api-error">Error: {error}</div>}

      {roster.length > 0 && (
        <div className="roster-list">
          {roster.map((player, i) => (
            <PlayerCard
              key={player.slug || player.name || i}
              player={player}
              teamName={selectedTeam}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function findWeakLinks(roster, rosterDetails, statKey, label) {
  const withStats = rosterDetails.filter(p => p && p[statKey] !== undefined)
  if (!withStats.length) return null
  const sorted = [...withStats].sort((a, b) => parseInt(a[statKey]) - parseInt(b[statKey]))
  return sorted.slice(0, 3).map(p => ({
    name: p.name || p.player_name,
    value: p[statKey],
  }))
}

function dedupeByName(list) {
  const seen = new Set()
  return (list || []).filter(b => {
    if (seen.has(b.name)) return false
    seen.add(b.name)
    return true
  })
}

// A short preview shown when the game plan is minimized — first sentence-ish chunk, not a mid-word cut.
function summarizePlan(text, maxLen = 160) {
  if (!text) return ''
  const trimmed = text.trim()
  if (trimmed.length <= maxLen) return trimmed
  return trimmed.slice(0, maxLen).replace(/\s+\S*$/, '') + '…'
}

function MatchupAnalyzer({ myRoster, myTeam, opponentRoster, opponentTeam }) {
  const [gamePlan, setGamePlan] = useState(null)
  const [planLoading, setPlanLoading] = useState(false)
  const [planError, setPlanError] = useState(null)
  const [planMinimized, setPlanMinimized] = useState(false)
  const [activeTab, setActiveTab] = useState('scouting')
  const [opponentStrategy, setOpponentStrategy] = useState('')

  // Starting five (5v5) is used only for on-court assignments — bestMatchups can't put more
  // than 5 defenders on the floor. Everything else scouts the full rotation (top 8 by overall)
  // so bench pieces a good opponent will actually play show up too.
  const myStartingFive = topByOverall(myRoster, 5)
  const oppStartingFive = topByOverall(opponentRoster, 5)
  const myRotation = topByOverall(myRoster, ROTATION_SIZE)
  const oppRotation = topByOverall(opponentRoster, ROTATION_SIZE)

  const myReport = computeScoutingReport(myRoster, opponentRoster)
  const theirReport = computeScoutingReport(opponentRoster, myRoster)
  const { attackTargets, hideTargets, leaveOpen, speedAdvantage } = myReport

  const clutchPlayers = myRotation
    .map(p => ({
      name: p.name,
      overall: p.overall,
      archetype: p.archetype,
      shotIQ: p.attributes.shotIQ ?? 0,
      offCon: p.attributes.offensiveConsistency ?? 0,
      clutchScore: (p.attributes.shotIQ ?? 0) + (p.attributes.offensiveConsistency ?? 0),
    }))
    .sort((a, b) => b.clutchScore - a.clutchScore)
    .slice(0, 3)

  const HOF_TIERS = ['legendary', 'hall of fame', 'gold']
  const myTopPlayers = myRotation.map(p => ({
    name: p.name,
    overall: p.overall,
    badges: dedupeByName(p.badges?.list).filter(b =>
      HOF_TIERS.some(t => (b.tier || '').toLowerCase().includes(t))
    ),
  }))

  const bestMatchups = (() => {
    const threats = oppStartingFive
    const usedDefenders = new Set()
    return threats.map(threat => {
      const oppPos = threat.positions || []
      const isBig = isBigPlayer(threat)
      // Stretch bigs (PF/C with 3PT ≥ 78) need a perimeter defender, not a shot blocker
      const isStretchBig = isBig && (threat.attributes?.threePointShot ?? 0) >= 78
      const big = isBig && !isStretchBig
      const defStat = big ? 'interiorDefense' : 'perimeterDefense'
      const statLabel = big ? 'Interior Defense' : 'Perimeter Defense'

      const samePos = myStartingFive.filter(p => !usedDefenders.has(p.name) && (p.positions || []).some(pos => oppPos.includes(pos)))
      const pool = samePos.length > 0 ? samePos : myStartingFive.filter(p => !usedDefenders.has(p.name))
      const defender = [...pool].sort((a, b) => (b.attributes[defStat] ?? 0) - (a.attributes[defStat] ?? 0))[0]
      if (defender) usedDefenders.add(defender.name)

      return defender ? {
        threat: threat.name,
        threatOverall: threat.overall,
        threatPos: oppPos[0],
        threatArchetype: threat.archetype,
        defender: defender.name,
        defValue: defender.attributes[defStat] ?? '—',
        statLabel,
      } : null
    }).filter(Boolean)
  })()

  const bestDefenders = computeBestDefenders(myRoster)
  const pnrGuidance = computePnRGuidance(myRoster, opponentRoster)

  async function getAIGamePlan() {
    setPlanLoading(true)
    setPlanError(null)
    setGamePlan(null)
    try {
      const HOF_BADGE_TIERS = ['legendary', 'hall of fame', 'gold']
      const topBadges = p => dedupeByName(p.badges?.list ?? [])
        .filter(b => HOF_BADGE_TIERS.some(t => (b.tier||'').toLowerCase().includes(t)))
        .slice(0, 5)
        .map(b => `${b.name} (${getBadgeTierLabel(b.tier)})`)

      const myKeyPlayers = myRotation.map((p, i) => ({ name: p.name, overall: p.overall, archetype: p.archetype, positions: p.positions, badges: topBadges(p), bench: i >= 5 }))
      const oppKeyPlayers = oppRotation.map((p, i) => ({ name: p.name, overall: p.overall, archetype: p.archetype, positions: p.positions, badges: topBadges(p), bench: i >= 5 }))

      const speedAdvantagePayload = speedAdvantage.map(m => ({
        myPlayer: m.attackerPlayer, mySpeed: m.attackerSpeed, oppPlayer: m.targetPlayer, oppSpeed: m.targetSpeed, diff: m.diff,
      }))
      const theirSpeedAdvantage = theirReport.speedAdvantage.map(m => ({
        theirPlayer: m.attackerPlayer, theirSpeed: m.attackerSpeed, myPlayer: m.targetPlayer, mySpeed: m.targetSpeed, diff: m.diff,
      }))

      const topDefenders = {
        lockdownPerimeter: bestDefenders.lockdownPerimeter.slice(0, 2).map(p => ({ name: p.name, perim: p.perim })),
        paintDefenders: bestDefenders.paintDefenders.slice(0, 2).map(p => ({ name: p.name, interior: p.interior })),
      }

      const lineupsPayload = lineups.map(l => ({ name: l.name, desc: l.desc, players: l.players.map(p => p.name) }))

      const res = await fetch(GAMEPLAN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          myTeam, opponentTeam,
          attackTargets, hideTargets, leaveOpen,
          speedAdvantage: speedAdvantagePayload, bestMatchups,
          myKeyPlayers, oppKeyPlayers,
          pnrGuidance,
          theirAttackTargets: theirReport.attackTargets,
          theirHideTargets: theirReport.hideTargets,
          myPlayersLeftOpen: theirReport.leaveOpen,
          theirSpeedAdvantage,
          topDefenders,
          lineups: lineupsPayload,
          opponentStrategy: opponentStrategy.trim(),
        }),
      })
      if (!res.ok) throw new Error(`Lambda error ${res.status}`)
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setGamePlan(data.gamePlan)
      setPlanMinimized(false)
    } catch (e) {
      setPlanError(e.message)
    } finally {
      setPlanLoading(false)
    }
  }

  // Lineup combinations
  const withAttrs = myRoster.filter(p => p.attributes)
  const isBigP = isBigPlayer

  const bestOverallLineup = pickPositionalLineup(withAttrs, p => p.overall ?? 0)

  const bestDefensiveLineup = [...withAttrs]
    .sort((a, b) => ((b.attributes.perimeterDefense??0) + (b.attributes.interiorDefense??0) + (b.attributes.steal??0) + (b.attributes.block??0)) -
                    ((a.attributes.perimeterDefense??0) + (a.attributes.interiorDefense??0) + (a.attributes.steal??0) + (a.attributes.block??0)))
    .slice(0, 5)

  const best3ptLineup = pickPositionalLineup(withAttrs, p => p.attributes.threePointShot ?? 0)

  const lineups = [
    { name: 'Best Overall Lineup', desc: 'Highest-rated five available, positionally balanced', players: bestOverallLineup,
      getStat: p => ({ label: 'OVR', val: p.overall ?? '—' }) },
    { name: 'Best Defensive Lineup', desc: 'Maximum defensive pressure across all positions', players: bestDefensiveLineup,
      getStat: p => ({ label: isBigP(p) ? 'Int. Def' : 'Per. Def', val: (isBigP(p) ? p.attributes.interiorDefense : p.attributes.perimeterDefense) ?? '—' }) },
    { name: 'Best 3PT Lineup', desc: 'Best 3PT shooters to space the floor and punish close-outs', players: best3ptLineup,
      getStat: p => ({ label: '3PT', val: p.attributes.threePointShot ?? '—' }) },
  ]

  const edges = computeMatchupEdges(myRoster, opponentRoster)
  const TABS = [
    { id: 'scouting', label: 'Scouting' },
    { id: 'best', label: 'Best Defenders' },
    { id: 'matchups', label: 'Matchups' },
    { id: 'pnr', label: 'Pick & Roll' },
    { id: 'theirplan', label: 'Their Game Plan' },
    { id: 'lineups', label: 'Lineups' },
    { id: 'ai-plan', label: 'AI Plan' },
  ]

  return (
    <div className="matchup-analyzer">
      <h2 className="analyzer-title">Matchup Analyzer</h2>
      <p className="analyzer-subtitle">{myTeam} vs {opponentTeam}</p>

      <div className="matchup-edges-card">
        <div className="matchup-edges-header">
          <span className="edges-team-name">{myTeam}</span>
          <span className="edges-center-title">Matchup Edges</span>
          <span className="edges-team-name edges-team-opp">{opponentTeam}</span>
        </div>
        {edges.map((e, i) => {
          const myWins = e.my > e.opp
          const tie = e.my === e.opp
          const myColor  = tie ? '#64748b' : myWins ? '#22c55e' : '#ef4444'
          const oppColor = tie ? '#64748b' : !myWins ? '#22c55e' : '#ef4444'
          return (
            <div key={i} className="edge-row">
              <span className="edge-val" style={{ color: myColor }}>{e.my}</span>
              <span className="edge-label">{e.label}</span>
              <span className="edge-val edge-val-opp" style={{ color: oppColor }}>{e.opp}</span>
            </div>
          )
        })}
      </div>

      <div className="analyzer-tabs">
        {TABS.map(tab => (
          <button key={tab.id} className={`analyzer-tab${activeTab === tab.id ? ' active' : ''}`} onClick={() => setActiveTab(tab.id)}>
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'scouting' && (
        <div className="analysis-grid">
          <div className="analysis-card">
            <div className="analysis-card-title">Attack Offensively</div>
            <p className="analysis-hint">Weakest defenders on {opponentTeam} — "Badged Up" means the raw rating undersells them</p>
            {attackTargets.length === 0 && <p className="no-data">Insufficient data</p>}
            {attackTargets.map((p, i) => (
              <div key={i} className="analysis-row-block">
                <div className="analysis-row">
                  <span className="analysis-name">
                    {p.name}
                    {p.badged && <span className="badged-tag">Badged Up</span>}
                  </span>
                  <span className="analysis-stats">
                    <span style={{ color: getRatingColor(p.perim) }}>Per. Def {p.perim}</span>
                    {' / '}
                    <span style={{ color: getRatingColor(p.interior) }}>Int. Def {p.interior}</span>
                  </span>
                </div>
                <DefBadgeChips badges={p.badges} />
              </div>
            ))}
          </div>

          <div className="analysis-card">
            <div className="analysis-card-title">Hide Defensively</div>
            <p className="analysis-hint">Weakest perimeter defenders on {myTeam} — "Badged Up" means he's better than the raw rating suggests</p>
            {hideTargets.length === 0 && <p className="no-data">Insufficient data</p>}
            {hideTargets.map((p, i) => (
              <div key={i} className="analysis-row-block">
                <div className="analysis-row">
                  <span className="analysis-name">
                    {p.name}
                    {p.badged && <span className="badged-tag">Badged Up</span>}
                  </span>
                  <span className="analysis-stats">
                    <span style={{ color: getRatingColor(p.perim) }}>Per. Def {p.perim}</span>
                  </span>
                </div>
                <DefBadgeChips badges={p.badges} />
              </div>
            ))}
          </div>

          <div className="analysis-card">
            <div className="analysis-card-title">Leave Open</div>
            <p className="analysis-hint">Worst shooters on {opponentTeam} — sag off to help</p>
            {leaveOpen.length === 0 && <p className="no-data">Insufficient data</p>}
            {leaveOpen.map((p, i) => (
              <div key={i} className="analysis-row">
                <span className="analysis-name">{p.name}</span>
                <span className="analysis-stats">
                  <span style={{ color: getRatingColor(p.three) }}>Three-Point {p.three}</span>
                  {' / '}
                  <span style={{ color: getRatingColor(p.mid) }}>Mid-Range {p.mid}</span>
                </span>
              </div>
            ))}
          </div>

          <div className="analysis-card">
            <div className="analysis-card-title">Speed Advantage</div>
            <p className="analysis-hint">Your guards/wings who significantly outrun their matchup</p>
            {speedAdvantage.length === 0 && <p className="no-data">No major speed mismatches</p>}
            {speedAdvantage.map((m, i) => (
              <div key={i} className="analysis-row">
                <div className="matchup-pair">
                  <span className="matchup-threat">
                    {m.attackerPlayer}
                    <span style={{ color: getRatingColor(m.attackerSpeed), marginLeft: 6, fontSize: 12 }}>Speed {m.attackerSpeed}</span>
                  </span>
                  <span className="matchup-arrow">vs</span>
                  <span className="matchup-defender">
                    {m.targetPlayer}
                    <span style={{ color: getRatingColor(m.targetSpeed), marginLeft: 6, fontSize: 12 }}>Speed {m.targetSpeed}</span>
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="analysis-card">
            <div className="analysis-card-title">Clutch Players</div>
            <p className="analysis-hint">Highest Shot IQ + Offensive Consistency — go-to players in tight moments</p>
            {clutchPlayers.map((p, i) => (
              <div key={i} className="analysis-row">
                <span className="analysis-name">{p.name}</span>
                <span className="analysis-stats">
                  <span style={{ color: getRatingColor(p.shotIQ) }}>Shot IQ {p.shotIQ}</span>
                  {' / '}
                  <span style={{ color: getRatingColor(p.offCon) }}>Off. Con {p.offCon}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'best' && (
        <div className="analysis-grid">
          <div className="analysis-card">
            <div className="analysis-card-title">Best Lockdown Perimeter Defenders</div>
            <p className="analysis-hint">Full {myTeam} roster, ranked by Perimeter Defense + agility + defensive badges — a high rating with slow feet still gets beat off the dribble</p>
            {bestDefenders.lockdownPerimeter.length === 0 && <p className="no-data">Insufficient data</p>}
            {bestDefenders.lockdownPerimeter.map((p, i) => (
              <div key={i} className="analysis-row-block">
                <div className="analysis-row">
                  <span className="analysis-name">{p.name}</span>
                  <span className="analysis-stats">
                    <span style={{ color: getRatingColor(p.perim) }}>Per. Def {p.perim}</span>
                    {' / '}
                    <span style={{ color: getRatingColor(p.speed) }}>Speed {p.speed}</span>
                    {' / '}
                    <span style={{ color: getRatingColor(p.steal) }}>Steal {p.steal}</span>
                  </span>
                </div>
                <DefBadgeChips badges={p.badges} />
              </div>
            ))}
          </div>

          <div className="analysis-card">
            <div className="analysis-card-title">Best Paint Defenders</div>
            <p className="analysis-hint">Full {myTeam} roster, ranked by Interior Defense + Block + defensive badges</p>
            {bestDefenders.paintDefenders.length === 0 && <p className="no-data">Insufficient data</p>}
            {bestDefenders.paintDefenders.map((p, i) => (
              <div key={i} className="analysis-row-block">
                <div className="analysis-row">
                  <span className="analysis-name">{p.name}</span>
                  <span className="analysis-stats">
                    <span style={{ color: getRatingColor(p.interior) }}>Int. Def {p.interior}</span>
                    {' / '}
                    <span style={{ color: getRatingColor(p.block) }}>Block {p.block}</span>
                  </span>
                </div>
                <DefBadgeChips badges={p.badges} />
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'matchups' && (
        <div className="analysis-grid">
          <div className="analysis-card analysis-card--matchups">
            <div className="analysis-card-title">Best Matchups</div>
            <p className="analysis-hint">Your best positional defender for each of {opponentTeam}'s top players</p>
            {bestMatchups.map((m, i) => (
              <div key={i} className="analysis-row">
                <div className="matchup-pair">
                  <span className="matchup-threat">
                    <span className="player-pos" style={{ marginRight: 6 }}>{m.threatPos}</span>
                    {m.threat}
                    <span style={{ color: getRatingColor(m.threatOverall), marginLeft: 6, fontWeight: 700 }}>{m.threatOverall}</span>
                  </span>
                  <span className="matchup-arrow">→</span>
                  <span className="matchup-defender">
                    {m.defender}
                    <span style={{ color: getRatingColor(m.defValue), marginLeft: 6, fontSize: 12 }}>{m.statLabel} {m.defValue}</span>
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="analysis-card analysis-card--badges">
            <div className="analysis-card-title">My Team's Best Badges</div>
            {myTopPlayers.map((p, i) => (
              <div key={i} className="badge-player-row">
                <div className="badge-player-name">
                  <span style={{ color: getRatingColor(p.overall) }}>{p.overall}</span>
                  {' '}{p.name}
                </div>
                {p.badges.length > 0 ? (
                  <div className="badge-player-chips">
                    {p.badges.map((b, j) => (
                      <span key={j} className="badge-chip small" style={{ borderColor: getBadgeTierColor(b.tier), color: getBadgeTierColor(b.tier) }}>
                        {b.name} · {getBadgeTierLabel(b.tier)}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="no-data">No Legendary/HoF/Gold badges</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'pnr' && (
        <div className="analysis-grid">
          <div className="analysis-card analysis-card--matchups">
            <div className="analysis-card-title">Pick-and-Roll Coverage</div>
            <p className="analysis-hint">
              {pnrGuidance.length > 0
                ? `Recommended coverage for your bigs against ${opponentTeam}'s top pick-and-roll threats`
                : 'Insufficient data for pick-and-roll coverage'}
            </p>
            {pnrGuidance.map((g, i) => (
              <div key={i} className="pnr-row">
                <div className="pnr-row-header">
                  <span className="pnr-big">{g.big}</span>
                  <span className="pnr-coverage-tag">{g.coverage}</span>
                </div>
                <p className="pnr-matchup">vs {g.handler}, screened by {g.screener}</p>
                <p className="pnr-reason">{g.reason}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'theirplan' && (
        <div className="analysis-grid">
          <div className="analysis-card">
            <div className="analysis-card-title">What They'll Attack</div>
            <p className="analysis-hint">Weak links on {myTeam} they'll target — "Badged Up" means it's not as easy as the rating looks</p>
            {theirReport.attackTargets.length === 0 && <p className="no-data">Insufficient data</p>}
            {theirReport.attackTargets.map((p, i) => (
              <div key={i} className="analysis-row-block">
                <div className="analysis-row">
                  <span className="analysis-name">
                    {p.name}
                    {p.badged && <span className="badged-tag">Badged Up</span>}
                  </span>
                  <span className="analysis-stats">
                    <span style={{ color: getRatingColor(p.perim) }}>Per. Def {p.perim}</span>
                    {' / '}
                    <span style={{ color: getRatingColor(p.interior) }}>Int. Def {p.interior}</span>
                  </span>
                </div>
                <DefBadgeChips badges={p.badges} />
              </div>
            ))}
          </div>

          <div className="analysis-card">
            <div className="analysis-card-title">Defenders They'll Hide</div>
            <p className="analysis-hint">{opponentTeam}'s weak perimeter defenders — hunt these matchups (watch for "Badged Up")</p>
            {theirReport.hideTargets.length === 0 && <p className="no-data">Insufficient data</p>}
            {theirReport.hideTargets.map((p, i) => (
              <div key={i} className="analysis-row-block">
                <div className="analysis-row">
                  <span className="analysis-name">
                    {p.name}
                    {p.badged && <span className="badged-tag">Badged Up</span>}
                  </span>
                  <span className="analysis-stats">
                    <span style={{ color: getRatingColor(p.perim) }}>Per. Def {p.perim}</span>
                  </span>
                </div>
                <DefBadgeChips badges={p.badges} />
              </div>
            ))}
          </div>

          <div className="analysis-card">
            <div className="analysis-card-title">Your Players They'll Leave Open</div>
            <p className="analysis-hint">Poor shooters on {myTeam} — they'll sag off to help</p>
            {theirReport.leaveOpen.length === 0 && <p className="no-data">Insufficient data</p>}
            {theirReport.leaveOpen.map((p, i) => (
              <div key={i} className="analysis-row">
                <span className="analysis-name">{p.name}</span>
                <span className="analysis-stats">
                  <span style={{ color: getRatingColor(p.three) }}>Three-Point {p.three}</span>
                  {' / '}
                  <span style={{ color: getRatingColor(p.mid) }}>Mid-Range {p.mid}</span>
                </span>
              </div>
            ))}
          </div>

          <div className="analysis-card">
            <div className="analysis-card-title">Their Speed Advantage</div>
            <p className="analysis-hint">Where they'll try to blow by you</p>
            {theirReport.speedAdvantage.length === 0 && <p className="no-data">No major speed mismatches</p>}
            {theirReport.speedAdvantage.map((m, i) => (
              <div key={i} className="analysis-row">
                <div className="matchup-pair">
                  <span className="matchup-threat">
                    {m.attackerPlayer}
                    <span style={{ color: getRatingColor(m.attackerSpeed), marginLeft: 6, fontSize: 12 }}>Speed {m.attackerSpeed}</span>
                  </span>
                  <span className="matchup-arrow">vs</span>
                  <span className="matchup-defender">
                    {m.targetPlayer}
                    <span style={{ color: getRatingColor(m.targetSpeed), marginLeft: 6, fontSize: 12 }}>Speed {m.targetSpeed}</span>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'lineups' && (
        <div className="lineups-grid">
          {lineups.map((lineup, i) => (
            <div key={i} className="lineup-card">
              <div className="lineup-card-title">{lineup.name}</div>
              <p className="lineup-card-desc">{lineup.desc}</p>
              {lineup.players.map((p, j) => {
                const stat = lineup.getStat(p)
                return (
                  <div key={j} className="lineup-player-row">
                    <span className="lineup-player-pos">{(p.positions||[])[0] || '—'}</span>
                    <span className="lineup-player-name">{p.name}</span>
                    <span className="lineup-player-stat" style={{ color: getRatingColor(stat.val) }}>{stat.label} {stat.val}</span>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}

      {activeTab === 'ai-plan' && (
        <div className="ai-plan-tab">
          <div className="strategy-input-group">
            <label className="strategy-label">Opponent's offensive strategy (optional)</label>
            <textarea
              className="strategy-textarea"
              placeholder="e.g. heavy pick and roll with their center, lots of corner 3s, iso-heavy on their best player..."
              value={opponentStrategy}
              onChange={e => setOpponentStrategy(e.target.value)}
              rows={3}
            />
          </div>
          {!planLoading && !gamePlan && (
            <button className="analyze-btn ai-plan-btn" onClick={getAIGamePlan}>Get AI Game Plan</button>
          )}
          {planLoading && <Spinner label="Generating game plan…" />}
          {planError && <div className="api-error">AI error: {planError}</div>}
          {gamePlan && !planMinimized && (
            <div className="game-plan">
              <div className="game-plan-header">
                <div className="game-plan-title">AI Game Plan</div>
                <button className="game-plan-toggle-btn" onClick={() => setPlanMinimized(true)}>Minimize</button>
              </div>
              <p className="game-plan-text">{gamePlan}</p>
              <button className="analyze-btn ai-plan-regen" onClick={getAIGamePlan}>Regenerate</button>
            </div>
          )}
          {gamePlan && planMinimized && (
            <div className="game-plan game-plan--minimized">
              <div className="game-plan-header">
                <div className="game-plan-title">AI Game Plan (minimized)</div>
                <button className="game-plan-toggle-btn" onClick={() => setPlanMinimized(false)}>Expand</button>
              </div>
              <p className="game-plan-summary">{summarizePlan(gamePlan)}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function TeamRankings({ teams, teamsLoading }) {
  const [rosterMap, setRosterMap] = useState(null)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [fetchStarted, setFetchStarted] = useState(false)

  useEffect(() => {
    if (fetchStarted || teamsLoading || teams.length === 0) return
    setFetchStarted(true)
    const total = teams.length
    setProgress({ done: 0, total })
    const results = {}
    const BATCH = 6
    ;(async () => {
      for (let i = 0; i < teams.length; i += BATCH) {
        await Promise.all(teams.slice(i, i + BATCH).map(async t => {
          try {
            const data = await apiFetch(`/api/teams/${encodeURIComponent(t.teamName)}/roster?teamType=allt`)
            results[t.teamName] = Array.isArray(data) ? data : data.data || data.roster || data.players || []
          } catch {
            results[t.teamName] = []
          }
          setProgress(p => ({ done: p.done + 1, total: p.total }))
        }))
      }
      setRosterMap({ ...results })
    })()
  }, [teams, teamsLoading])

  const isLoading = !rosterMap || progress.done < progress.total
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  const avgStat = (arr, fn) => {
    const vals = arr.map(fn).filter(v => v > 0)
    return vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : 0
  }

  const STAT_CATEGORIES = [
    {
      key: 'speed', label: 'Speed',
      compute: roster => {
        const pool = roster.filter(p => p.attributes && (p.positions||[]).some(pos => PERIMETER.includes(pos)))
        return avgStat(pool, p => p.attributes.speed ?? 0)
      },
    },
    {
      key: 'perimDef', label: 'Perimeter Defense',
      compute: roster => {
        const pool = roster.filter(p => p.attributes && (p.positions||[]).some(pos => PERIMETER.includes(pos)))
        return avgStat(pool, p => p.attributes.perimeterDefense ?? 0)
      },
    },
    {
      key: 'intDef', label: 'Interior Defense',
      compute: roster => {
        const pool = roster.filter(p => p.attributes && (p.positions||[]).some(pos => BIGS.includes(pos)))
        return avgStat(pool.length ? pool : roster.filter(p => p.attributes), p => p.attributes.interiorDefense ?? 0)
      },
    },
    {
      key: 'three', label: '3PT Shooting',
      compute: roster => {
        const pool = roster.filter(p => p.attributes && (p.positions||[]).some(pos => PERIMETER.includes(pos)))
        return avgStat(pool, p => p.attributes.threePointShot ?? 0)
      },
    },
    {
      key: 'reb', label: 'Rebounding',
      compute: roster => {
        const pool = roster.filter(p => p.attributes)
        return avgStat(pool, p => Math.round(((p.attributes.offensiveRebound ?? 0) + (p.attributes.defensiveRebound ?? 0)) / 2))
      },
    },
  ]

  const rankings = rosterMap
    ? STAT_CATEGORIES.map(cat => ({
        ...cat,
        rows: Object.entries(rosterMap)
          .map(([name, roster]) => ({ name, val: cat.compute(roster) }))
          .filter(t => t.val > 0)
          .sort((a, b) => b.val - a.val)
          .slice(0, 10),
      }))
    : []

  return (
    <div className="team-rankings">
      <h2 className="rankings-title">Team Rankings</h2>
      <p className="rankings-subtitle">All-Time teams ranked by key stats</p>

      {isLoading && (
        <div className="rankings-loading">
          <Spinner center label={`Loading rosters… ${progress.done} / ${progress.total}`} />
          <div className="progress-bar-wrap">
            <div className="progress-bar" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {!isLoading && (
        <div className="rankings-grid">
          {rankings.map(cat => (
            <div key={cat.key} className="ranking-category">
              <div className="ranking-category-title">{cat.label}</div>
              {cat.rows.map((t, i) => (
                <div key={t.name} className="ranking-row">
                  <span className="rank-num">{i + 1}</span>
                  <span className="rank-team">{t.name}</span>
                  <span className="rank-val" style={{ color: getRatingColor(t.val) }}>{t.val}</span>
                </div>
              ))}
              {cat.rows.length === 0 && <p className="no-data">No data</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem('2ks-theme') || 'light')
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('2ks-theme', theme)
  }, [theme])
  const toggle = () => setTheme(t => (t === 'light' ? 'dark' : 'light'))
  return [theme, toggle]
}

async function attemptLogin(email, password) {
  try {
    const res = await fetch(`${AUTH_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    if (res.ok) {
      const d = await res.json()
      return { token: d.token, user: d.user }
    }
    if (res.status === 401) return { error: 'Invalid email or password' }
  } catch {
    // network error — fall through to the local demo check below
  }
  // Demo fallback so the app stays usable without the auth service (local dev / legacy EC2)
  if (email.trim().toLowerCase() === DEMO_EMAIL && password === DEMO_PASSWORD) {
    return { token: 'demo-' + Date.now(), user: { email: DEMO_EMAIL, name: 'Scout' } }
  }
  return { error: 'Invalid email or password' }
}

function Login({ onLogin, theme, onToggleTheme }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = await attemptLogin(email, password)
    setBusy(false)
    if (res.error) { setError(res.error); return }
    onLogin(res.token, res.user)
  }

  return (
    <div className="login-screen">
      <button className="theme-toggle login-theme-toggle" onClick={onToggleTheme} title="Toggle theme">
        {theme === 'light' ? <IconMoon /> : <IconSun />}
      </button>
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          <span className="brand-mark">2K</span>
          <span className="brand-name">Scout DEV2</span>
        </div>
        <h1 className="login-title">Sign in</h1>
        <p className="login-sub">Pre-game scouting for NBA 2K All-Time teams</p>

        <label className="login-label">Email</label>
        <input className="login-input" type="email" autoComplete="username"
          value={email} onChange={e => setEmail(e.target.value)} placeholder="scout@2kscout.app" required />

        <label className="login-label">Password</label>
        <input className="login-input" type="password" autoComplete="current-password"
          value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required />

        {error && <div className="login-error">{error}</div>}

        <button className="login-btn" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign In'}
        </button>

        <div className="login-demo">
          Demo access — <strong>{DEMO_EMAIL}</strong> / <strong>{DEMO_PASSWORD}</strong>
        </div>
      </form>
    </div>
  )
}

function StatCard({ icon, label, value, hint }) {
  return (
    <div className="dash-stat-card">
      <div className="dash-stat-icon">{icon}</div>
      <div className="dash-stat-value">{value}</div>
      <div className="dash-stat-label">{label}</div>
      {hint && <div className="dash-stat-hint">{hint}</div>}
    </div>
  )
}

function DashboardHome({ user, teams, teamsLoading, myTeam, oppTeam, onStart, onRankings }) {
  const ready = myTeam && oppTeam
  return (
    <div className="dash-home">
      <div className="dash-welcome">
        <h2 className="dash-welcome-title">Welcome back, {user?.name || 'Scout'}</h2>
        <p className="dash-welcome-sub">Scout any two All-Time rosters and build a game plan from pure 2K ratings.</p>
      </div>

      <div className="dash-stats-grid">
        <StatCard icon={<IconUsers />} label="All-Time Teams" value={teamsLoading ? '—' : teams.length} hint="Available to scout" />
        <StatCard icon={<IconTarget />} label="Current Matchup" value={ready ? 'Ready' : 'None'} hint={ready ? `${myTeam} vs ${oppTeam}` : 'Pick two teams to begin'} />
        <StatCard icon={<IconRankings />} label="Ranking Categories" value="5" hint="Speed · Def · 3PT · Reb" />
        <StatCard icon={<IconBolt />} label="AI Game Plans" value="On" hint="Powered by Claude" />
      </div>

      <div className="dash-cta-row">
        <button className="dash-cta primary" onClick={onStart}>
          <div>
            <div className="dash-cta-title">Start a Matchup</div>
            <div className="dash-cta-sub">Select your team and an opponent</div>
          </div>
          <IconArrowRight size={20} />
        </button>
        <button className="dash-cta" onClick={onRankings}>
          <div>
            <div className="dash-cta-title">Browse Team Rankings</div>
            <div className="dash-cta-sub">League-wide stat leaderboards</div>
          </div>
          <IconArrowRight size={20} />
        </button>
      </div>
    </div>
  )
}

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', Icon: IconDashboard },
  { id: 'scout', label: 'Scout', Icon: IconScout },
  { id: 'rankings', label: 'Rankings', Icon: IconRankings },
  { id: 'settings', label: 'Settings', Icon: IconSettings },
]

export default function App() {
  const [theme, toggleTheme] = useTheme()
  const [token, setToken] = useState(() => localStorage.getItem('2ks-token'))
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('2ks-user')) } catch { return null }
  })
  const [page, setPage] = useState('dashboard')

  const [teams, setTeams] = useState([])
  const [teamsLoading, setTeamsLoading] = useState(true)
  const [teamsError, setTeamsError] = useState(null)

  const [myTeam, setMyTeam] = useState('')
  const [myRoster, setMyRoster] = useState([])
  const [myRosterLoading, setMyRosterLoading] = useState(false)
  const [myRosterError, setMyRosterError] = useState(null)

  const [oppTeam, setOppTeam] = useState('')
  const [oppRoster, setOppRoster] = useState([])
  const [oppRosterLoading, setOppRosterLoading] = useState(false)
  const [oppRosterError, setOppRosterError] = useState(null)

  useEffect(() => {
    if (!token) return
    apiFetch('/api/teams?teamType=allt')
      .then(data => {
        const list = Array.isArray(data) ? data : data.data || data.teams || []
        setTeams(list)
      })
      .catch(e => setTeamsError(e.message))
      .finally(() => setTeamsLoading(false))
  }, [token])

  function handleLogin(tok, usr) {
    localStorage.setItem('2ks-token', tok)
    localStorage.setItem('2ks-user', JSON.stringify(usr))
    setToken(tok)
    setUser(usr)
    setPage('dashboard')
  }

  function handleLogout() {
    localStorage.removeItem('2ks-token')
    localStorage.removeItem('2ks-user')
    setToken(null)
    setUser(null)
  }

  async function fetchRoster(teamName, setRoster, setLoading, setError) {
    if (!teamName) return
    setLoading(true)
    setError(null)
    setRoster([])
    try {
      const data = await apiFetch(`/api/teams/${encodeURIComponent(teamName)}/roster?teamType=allt`)
      const roster = Array.isArray(data) ? data : data.data || data.roster || data.players || []
      setRoster(roster)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  function handleMyTeamChange(name) {
    setMyTeam(name)
    fetchRoster(name, setMyRoster, setMyRosterLoading, setMyRosterError)
  }

  function handleOppTeamChange(name) {
    setOppTeam(name)
    fetchRoster(name, setOppRoster, setOppRosterLoading, setOppRosterError)
  }

  if (!token) {
    return <Login onLogin={handleLogin} theme={theme} onToggleTheme={toggleTheme} />
  }

  const bothSelected = myTeam && oppTeam && myRoster.length > 0 && oppRoster.length > 0
  const initials = (user?.name || user?.email || 'S').slice(0, 1).toUpperCase()
  const pageTitle = NAV_ITEMS.find(n => n.id === page)?.label || 'Dashboard'

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="brand-mark">2K</span>
          <span className="brand-name">Scout DEV</span>
        </div>
        <nav className="sidebar-nav">
          {NAV_ITEMS.map(({ id, label, Icon }) => (
            <button key={id} className={`sidebar-link${page === id ? ' active' : ''}`} onClick={() => setPage(id)}>
              <Icon /><span>{label}</span>
            </button>
          ))}
        </nav>
        <button className="sidebar-link sidebar-logout" onClick={handleLogout}>
          <IconLogout /><span>Logout</span>
        </button>
      </aside>

      <div className="main">
        <header className="topbar">
          <h1 className="topbar-title">{pageTitle}</h1>
          <div className="topbar-actions">
            <button className="theme-toggle" onClick={toggleTheme} title="Toggle theme">
              {theme === 'light' ? <IconMoon /> : <IconSun />}
            </button>
            <div className="topbar-user">
              <span className="user-avatar">{initials}</span>
              <span className="user-name">{user?.name || 'Scout'}</span>
            </div>
          </div>
        </header>

        <main className="content">
          {page === 'dashboard' && (
            <DashboardHome
              user={user}
              teams={teams}
              teamsLoading={teamsLoading}
              myTeam={myTeam}
              oppTeam={oppTeam}
              onStart={() => setPage('scout')}
              onRankings={() => setPage('rankings')}
            />
          )}

          {page === 'scout' && (
            <>
              {teamsLoading && <Spinner center label="Loading teams…" />}
              {teamsError && <div className="api-error center-loading">Failed to load teams: {teamsError}</div>}
              {!teamsLoading && (
                <div className="panels-container">
                  <TeamPanel side="my" selectedTeam={myTeam} onTeamChange={handleMyTeamChange}
                    teams={teams} roster={myRoster} loading={myRosterLoading} error={myRosterError} />
                  <TeamPanel side="opp" selectedTeam={oppTeam} onTeamChange={handleOppTeamChange}
                    teams={teams} roster={oppRoster} loading={oppRosterLoading} error={oppRosterError} />
                </div>
              )}
              {bothSelected && (
                <MatchupAnalyzer myRoster={myRoster} myTeam={myTeam}
                  opponentRoster={oppRoster} opponentTeam={oppTeam} />
              )}
            </>
          )}

          {page === 'rankings' && (
            <TeamRankings teams={teams} teamsLoading={teamsLoading} />
          )}

          {page === 'settings' && (
            <div className="settings-page">
              <div className="settings-card">
                <div className="settings-card-title">Appearance</div>
                <div className="settings-row">
                  <div>
                    <div className="settings-row-label">Theme</div>
                    <div className="settings-row-hint">Switch between light and dark mode</div>
                  </div>
                  <button className="settings-theme-btn" onClick={toggleTheme}>
                    {theme === 'light' ? <><IconMoon size={16} /> Dark</> : <><IconSun size={16} /> Light</>}
                  </button>
                </div>
              </div>
              <div className="settings-card">
                <div className="settings-card-title">Account</div>
                <div className="settings-row">
                  <div>
                    <div className="settings-row-label">{user?.name || 'Scout'}</div>
                    <div className="settings-row-hint">{user?.email || DEMO_EMAIL}</div>
                  </div>
                  <button className="settings-logout-btn" onClick={handleLogout}>
                    <IconLogout size={16} /> Logout
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
