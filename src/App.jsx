import { useState, useEffect } from 'react'
import {
  LayoutDashboard, Search, BarChart3, Settings as SettingsIcon, LogOut, Sun, Moon,
  Users, Target, Zap, ArrowRight, History as HistoryIcon, Loader2, ChevronDown,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent, CardFooter } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import './App.css'

const API_KEY = import.meta.env.VITE_NBA2K_API_KEY ?? ''
// Origin of the backend gateway (services/gateway), e.g. https://api.example.com.
// Empty string keeps requests relative/same-origin, matching Vite's dev proxy and the
// in-cluster ingress setup. Set VITE_API_BASE when the UI is deployed separately from
// the gateway (e.g. static UI on Cloudflare Pages, gateway on its own host).
const API_BASE = import.meta.env.VITE_API_BASE ?? ''
const BASE_URL = API_BASE
const LAMBDA_URL = import.meta.env.VITE_LAMBDA_URL ?? ''
// In the Kubernetes deployment the gateway routes /api/gameplan to the AI service.
// Fall back to the standalone Lambda URL when one is configured (legacy / local dev).
const GAMEPLAN_URL = LAMBDA_URL || `${API_BASE}/api/gameplan`
const AUTH_BASE = import.meta.env.VITE_AUTH_BASE ?? `${API_BASE}/auth`
const DEMO_EMAIL = 'scout@2kscout.app'
const DEMO_PASSWORD = 'scout2k'

async function apiFetch(path) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'X-API-Key': API_KEY },
  })
  if (!res.ok) throw new Error(`API error ${res.status}: ${res.statusText}`)
  return res.json()
}

/* ── Icons (lucide-react, wrapped to keep the app's historical 18px default) ── */
const IconDashboard = p => <LayoutDashboard size={18} strokeWidth={1.7} {...p} />
const IconScout = p => <Search size={18} strokeWidth={1.7} {...p} />
const IconRankings = p => <BarChart3 size={18} strokeWidth={1.7} {...p} />
const IconSettings = p => <SettingsIcon size={18} strokeWidth={1.7} {...p} />
const IconLogout = p => <LogOut size={18} strokeWidth={1.7} {...p} />
const IconSun = p => <Sun size={18} strokeWidth={1.7} {...p} />
const IconMoon = p => <Moon size={18} strokeWidth={1.7} {...p} />
const IconUsers = p => <Users size={18} strokeWidth={1.7} {...p} />
const IconTarget = p => <Target size={18} strokeWidth={1.7} {...p} />
const IconBolt = p => <Zap size={18} strokeWidth={1.7} {...p} />
const IconArrowRight = p => <ArrowRight size={18} strokeWidth={1.7} {...p} />
const IconChevronDown = p => <ChevronDown size={14} strokeWidth={2} {...p} />
const IconHistory = p => <HistoryIcon size={18} strokeWidth={1.7} {...p} />

// Monochrome emphasis ramp (per the reference design): elite ratings read near-black,
// weak ones fade out — information without the traffic-light color noise.
function getRatingColor(val) {
  const n = parseInt(val, 10)
  if (isNaN(n)) return 'var(--muted-foreground)'
  if (n >= 90) return 'var(--rating-strong)'
  if (n >= 75) return 'var(--rating-mid)'
  return 'var(--rating-weak)'
}

// 2K card-tier chip colors (Galaxy Opal → Pink Diamond → Diamond → Amethyst → base),
// matching the rating pills on the nba2kapi reference design.
function ratingChipStyle(val) {
  const n = parseInt(val, 10)
  if (isNaN(n)) return { background: '#e5e2da', color: '#57534a' }
  if (n >= 95) return { background: '#1a1918', color: '#faf9f5' }
  if (n >= 90) return { background: '#b79ce0', color: '#1a1918' }
  if (n >= 85) return { background: '#d9bd7c', color: '#1a1918' }
  return { background: '#e5e2da', color: '#57534a' }
}

function RatingChip({ value, className }) {
  if (value == null || value === '—') return null
  return (
    <span
      className={cn('inline-flex min-w-8 items-center justify-center rounded-md px-1.5 py-0.5 font-mono text-xs font-bold', className)}
      style={ratingChipStyle(value)}
    >
      {value}
    </span>
  )
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

// Best player on a roster by a single attribute (e.g. threePointShot) — used for the
// per-team "best 3PT / perimeter D / interior D" breakdown on Team Rankings.
function bestByAttribute(roster, attrKey) {
  const withAttr = (roster || []).filter(p => p.attributes && (p.attributes[attrKey] ?? 0) > 0)
  if (!withAttr.length) return null
  return withAttr.reduce((best, p) => (p.attributes[attrKey] > best.attributes[attrKey] ? p : best))
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
// Same idea applied to the Player Rankings leaderboards (Speed, 3PT, Rebounding) — a raw
// attribute doesn't capture a badged-up player's real edge in that category.
const SPEED_BADGES = ['quick first step', 'speed boost', 'unpluckable']
const THREE_POINT_BADGES = ['deadeye', 'catch and shoot', 'corner specialist', 'limitless range', 'space creator']
const REBOUNDING_BADGES = ['boxout beast', 'rebound chaser', 'putback boss']
const BADGE_TIER_WEIGHT = { legendary: 5, 'hall of fame': 4, hof: 4, gold: 3, silver: 2, bronze: 1 }
function badgeTierWeight(tier) { return BADGE_TIER_WEIGHT[(tier || '').toLowerCase()] ?? 0 }

function matchedBadges(player, badgeCatalog) {
  return dedupeByName(player.badges?.list ?? [])
    .filter(b => badgeCatalog.includes((b.name || '').toLowerCase()))
    .sort((a, b) => badgeTierWeight(b.tier) - badgeTierWeight(a.tier))
}

// Points added to a raw defense rating per matched badge, scaled so a single Gold badge (≈15pts)
// or HOF (≈20pts) meaningfully moves a player up the list — comparable to a real attribute edge.
function badgeBoostScore(player, badgeCatalog) {
  return matchedBadges(player, badgeCatalog).reduce((sum, b) => sum + badgeTierWeight(b.tier) * 5, 0)
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
      const perimBadges = matchedBadges(p, PERIMETER_DEFENSE_BADGES)
      const interiorBadges = matchedBadges(p, PAINT_DEFENSE_BADGES)
      const perimEffective = perim + badgeBoostScore(p, PERIMETER_DEFENSE_BADGES)
      const interiorEffective = interior + badgeBoostScore(p, PAINT_DEFENSE_BADGES)
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
        badges,
        effectiveRating: perimEffective + interiorEffective,
      }
    })
    .sort((a, b) => a.effectiveRating - b.effectiveRating)
    .slice(0, 3)

  const hideTargets = attackers
    .filter(isPerimeterPlayer)
    .map(p => {
      const perim = p.attributes.perimeterDefense ?? 99
      const badges = matchedBadges(p, PERIMETER_DEFENSE_BADGES)
      return {
        name: p.name, archetype: p.archetype, perim,
        badges,
        effectiveRating: perim + badgeBoostScore(p, PERIMETER_DEFENSE_BADGES),
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
      const agility = ((p.attributes.speed ?? 0) + (p.attributes.agility ?? 0)) / 2
      const badges = matchedBadges(p, PERIMETER_DEFENSE_BADGES)
      const badgeScore = badgeBoostScore(p, PERIMETER_DEFENSE_BADGES)
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
      const badges = matchedBadges(p, PAINT_DEFENSE_BADGES)
      const badgeScore = badgeBoostScore(p, PAINT_DEFENSE_BADGES)
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
      handleScore: (p.attributes.ballHandle ?? 0) * 0.4 + (p.attributes.speed ?? 0) * 0.3 + (p.attributes.agility ?? 0) * 0.3,
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
    const hedgeRecovery = ((big.attributes.speed ?? 0) + (big.attributes.agility ?? 0)) / 2
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

// Identifies the opponent's rim-camping anchor — their best paint defender — and produces
// personnel-specific tactics from MY roster to exploit the classic human-opponent pattern of
// parking a great shot-blocker in the paint all game. Every tactic only fires when the anchor's
// own attributes actually support it (e.g. no "drag him out" tip unless his 3PT is genuinely bad).
function computeBigManExploit(myRoster, oppRoster) {
  const oppBigs = oppRoster.filter(p => p.attributes && isBigPlayer(p))
  if (!oppBigs.length) return null

  const anchor = [...oppBigs].sort((a, b) =>
    ((b.attributes.interiorDefense ?? 0) + (b.attributes.block ?? 0)) -
    ((a.attributes.interiorDefense ?? 0) + (a.attributes.block ?? 0))
  )[0]
  const a = anchor.attributes

  const mobility = ((a.speed ?? 0) + (a.agility ?? 0)) / 2
  const perimThreat = a.perimeterDefense ?? 0
  const popThreat = a.threePointShot ?? 0
  const rebounding = ((a.offensiveRebound ?? 0) + (a.defensiveRebound ?? 0)) / 2

  const myAll = myRoster.filter(p => p.attributes)
  const myBigs = myAll.filter(isBigPlayer)
  const myPerim = myAll.filter(isPerimeterPlayer)

  const stretchBigs = [...myBigs]
    .filter(p => (p.attributes.threePointShot ?? 0) >= 74)
    .sort((a, b) => (b.attributes.threePointShot ?? 0) - (a.attributes.threePointShot ?? 0))
    .slice(0, 2)
  const finishers = [...myAll]
    .sort((a, b) => (b.attributes.closeShot ?? 0) - (a.attributes.closeShot ?? 0))
    .slice(0, 2)
  const foulBaiters = [...myAll]
    .filter(p => (p.attributes.drawFoul ?? 0) >= 75)
    .sort((a, b) => (b.attributes.drawFoul ?? 0) - (a.attributes.drawFoul ?? 0))
    .slice(0, 2)
  const weakSideShooters = [...myPerim]
    .sort((a, b) => (b.attributes.threePointShot ?? 0) - (a.attributes.threePointShot ?? 0))
    .slice(0, 2)
  const offRebBigs = [...myBigs]
    .sort((a, b) => (b.attributes.offensiveRebound ?? 0) - (a.attributes.offensiveRebound ?? 0))
    .slice(0, 2)

  const tactics = []

  if (popThreat < 70) {
    tactics.push({
      title: 'Drag him out of the paint',
      detail: stretchBigs.length
        ? `${anchor.name} has no real outside shot himself (${popThreat} 3PT) — play ${stretchBigs.map(p => p.name).join(' or ')} at the 4/5. He either follows out to the arc and abandons the rim, or sits home and gives up open threes.`
        : `${anchor.name} has no real outside shot himself (${popThreat} 3PT), but nobody in your rotation shoots well enough at the 4/5 to punish him for camping — a small-ball look would help here.`,
    })
  }

  if (mobility < 70) {
    tactics.push({
      title: 'Push it before he sets up',
      detail: `${anchor.name} isn't fast (Speed/Agility avg ${Math.round(mobility)}) — attack in early offense and transition before he gets back to camp the paint.`,
    })
  }

  tactics.push({
    title: 'Finish away from his contest',
    detail: `${anchor.name} blocks shots at a ${a.block ?? 0} rating — stop challenging him directly at the rim.${finishers.length ? ` Use ${finishers.map(p => p.name).join(' and ')} for floaters and push shots he can't reach.` : ''}`,
  })

  if (foulBaiters.length) {
    tactics.push({
      title: 'Pump-fake and draw the foul',
      detail: `${foulBaiters.map(p => p.name).join(' and ')} draw fouls well (${foulBaiters.map(p => p.attributes.drawFoul).join('/')} rated) — a shot-blocker camping in the paint waiting to contest is exactly the guy who bites on a pump fake into contact.`,
    })
  }

  if (perimThreat < 60 && weakSideShooters.length) {
    tactics.push({
      title: 'Skip pass to the weak side',
      detail: `${anchor.name} rarely leaves the paint (Per. Def ${perimThreat}) — swing the ball and let ${weakSideShooters.map(p => p.name).join(' or ')} shoot from the weak-side corner before he can rotate out.`,
    })
  }

  if (rebounding < 82 && offRebBigs.length) {
    tactics.push({
      title: 'Crash the offensive glass',
      detail: `${anchor.name}'s rebounding (avg ${Math.round(rebounding)}) isn't elite for a full-time rim-camper — send ${offRebBigs.map(p => p.name).join(' or ')} to crash on missed threes.`,
    })
  }

  return {
    anchor: {
      name: anchor.name, overall: anchor.overall, positions: anchor.positions, archetype: anchor.archetype,
      interior: a.interiorDefense ?? 0, block: a.block ?? 0, perim: perimThreat, speed: a.speed ?? 0, threePointShot: popThreat,
    },
    tactics,
  }
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

function TierBadge({ badge, className }) {
  return (
    <Badge variant="outline" className={cn('border-border bg-card text-secondary-foreground', className)}>
      {badge.name}{badge.tier ? ` · ${getBadgeTierLabel(badge.tier)}` : ''}
    </Badge>
  )
}

function DefBadgeChips({ badges }) {
  if (!badges || badges.length === 0) return null
  return (
    <div className="mt-1 flex flex-wrap gap-1.5">
      {badges.map((b, j) => (
        <TierBadge key={j} badge={b} className="px-1.5 text-[11px] font-medium" />
      ))}
    </div>
  )
}

function Spinner({ small, label, center }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 p-8 text-sm text-muted-foreground${center ? ' mt-10' : ''}`}>
      <Loader2 className={`animate-spin ${small ? 'size-5' : 'size-8'}`} />
      {label && <span>{label}</span>}
    </div>
  )
}

// Shaped like the roster list it's standing in for — a skeleton makes sense
// here because we already know exactly what's about to render.
function RosterSkeleton({ rows = 6 }) {
  return (
    <div className="flex flex-col gap-2 p-2" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-2">
          <Skeleton className="size-7 rounded-full" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3 w-3/5" />
            <Skeleton className="h-3 w-2/5" />
          </div>
        </div>
      ))}
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
  { label: 'Agility', key: 'agility' },
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
    <div className="flex flex-wrap gap-1.5">
      {sorted.map((badge, i) => (
        <TierBadge key={i} badge={badge} className="font-medium" />
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
        <Avatar className="size-8">
          {player.playerImage && <AvatarImage src={player.playerImage} alt="" />}
          <AvatarFallback>{player.name?.[0] ?? '?'}</AvatarFallback>
        </Avatar>
        <span className="player-name">{player.name}</span>
        <span className="player-meta">
          {player.positions && (
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
              {Array.isArray(player.positions) ? player.positions[0] : player.positions}
            </span>
          )}
          {overall && <RatingChip value={overall} />}
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
                <Avatar className="size-16 self-center border-2">
                  <AvatarImage src={detail.playerImage} alt={detail.name} />
                  <AvatarFallback className="text-lg">{detail.name?.[0] ?? '?'}</AvatarFallback>
                </Avatar>
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
  const teamLogo = teams.find(t => t.teamName === selectedTeam)?.logo

  return (
    <div className={`team-panel team-panel--${side}`}>
      <div className="panel-header">
        <div className="panel-header-title">
          {teamLogo && <img className="size-6 shrink-0 object-contain" src={teamLogo} alt="" onError={e => { e.target.style.display = 'none' }} />}
          <h2>{label}</h2>
        </div>
        <Select value={selectedTeam || undefined} onValueChange={onTeamChange}>
          <SelectTrigger className="w-full sm:w-[220px]">
            <SelectValue placeholder="— Select Team —" />
          </SelectTrigger>
          <SelectContent>
            {teams.map(t => (
              <SelectItem key={t.teamName} value={t.teamName}>
                {t.teamName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading && <RosterSkeleton />}
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

function MatchupAnalyzer({ myRoster, myTeam, opponentRoster, opponentTeam, token, teams }) {
  const myTeamLogo = teams?.find(t => t.teamName === myTeam)?.logo
  const oppTeamLogo = teams?.find(t => t.teamName === opponentTeam)?.logo
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
  const bigManExploit = computeBigManExploit(myRoster, opponentRoster)

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
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
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
          bigManExploit,
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
    { id: 'beatthebig', label: 'Beat Their Big' },
    { id: 'theirplan', label: 'Their Game Plan' },
    { id: 'lineups', label: 'Lineups' },
    { id: 'ai-plan', label: 'AI Plan' },
  ]

  return (
    <div className="matchup-analyzer">
      <h2 className="analyzer-title">Matchup Analyzer</h2>
      <p className="analyzer-subtitle">
        {myTeamLogo && <img className="size-5 shrink-0 object-contain" src={myTeamLogo} alt="" onError={e => { e.target.style.display = 'none' }} />}
        {myTeam} vs {opponentTeam}
        {oppTeamLogo && <img className="size-5 shrink-0 object-contain" src={oppTeamLogo} alt="" onError={e => { e.target.style.display = 'none' }} />}
      </p>

      <div className="matchup-edges-card">
        <div className="matchup-edges-header">
          <span className="edges-team-name">{myTeam}</span>
          <span className="edges-center-title">Matchup Edges</span>
          <span className="edges-team-name edges-team-opp">{opponentTeam}</span>
        </div>
        {edges.map((e, i) => {
          const myWins = e.my > e.opp
          const tie = e.my === e.opp
          const myColor  = tie ? 'var(--rating-weak)' : myWins ? 'var(--rating-strong)' : 'var(--ring)'
          const oppColor = tie ? 'var(--rating-weak)' : !myWins ? 'var(--rating-strong)' : 'var(--ring)'
          return (
            <div key={i} className="edge-row">
              <span className="edge-val" style={{ color: myColor }}>{e.my}</span>
              <span className="edge-label">{e.label}</span>
              <span className="edge-val edge-val-opp" style={{ color: oppColor }}>{e.opp}</span>
            </div>
          )
        })}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-4">
        <TabsList className="h-auto w-full flex-wrap justify-start">
          {TABS.map(tab => (
            <TabsTrigger key={tab.id} value={tab.id} className="flex-none">
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {activeTab === 'scouting' && (
        <div className="analysis-grid">
          <div className="analysis-card">
            <div className="analysis-card-title">Attack Offensively</div>
            <p className="analysis-hint">Weakest defenders on {opponentTeam}</p>
            {attackTargets.length === 0 && <p className="no-data">Insufficient data</p>}
            {attackTargets.map((p, i) => (
              <div key={i} className="analysis-row-block">
                <div className="analysis-row">
                  <span className="analysis-name">
                    {p.name}
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
            <p className="analysis-hint">Weakest perimeter defenders on {myTeam}</p>
            {hideTargets.length === 0 && <p className="no-data">Insufficient data</p>}
            {hideTargets.map((p, i) => (
              <div key={i} className="analysis-row-block">
                <div className="analysis-row">
                  <span className="analysis-name">
                    {p.name}
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
                  <div className="flex flex-wrap gap-1.5">
                    {p.badges.map((b, j) => (
                      <TierBadge key={j} badge={b} className="px-1.5 text-[11px] font-medium" />
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

      {activeTab === 'beatthebig' && (
        <div className="analysis-grid">
          <div className="analysis-card analysis-card--matchups">
            <div className="analysis-card-title">Beat Their Big</div>
            {!bigManExploit && <p className="no-data">Insufficient data</p>}
            {bigManExploit && (
              <>
                <p className="analysis-hint">
                  {opponentTeam}'s rim anchor — the shot-blocker a lot of opponents will camp in the paint all game
                </p>
                <div className="pnr-row">
                  <div className="pnr-row-header">
                    <span className="pnr-big">{bigManExploit.anchor.name}</span>
                    <span className="pnr-coverage-tag">{(bigManExploit.anchor.positions || [])[0] || 'Big'}</span>
                  </div>
                  <p className="pnr-matchup">
                    <span style={{ color: getRatingColor(bigManExploit.anchor.interior) }}>Int. Def {bigManExploit.anchor.interior}</span>
                    {' / '}
                    <span style={{ color: getRatingColor(bigManExploit.anchor.block) }}>Block {bigManExploit.anchor.block}</span>
                    {' / '}
                    <span style={{ color: getRatingColor(bigManExploit.anchor.perim) }}>Per. Def {bigManExploit.anchor.perim}</span>
                    {' / '}
                    <span style={{ color: getRatingColor(bigManExploit.anchor.speed) }}>Speed {bigManExploit.anchor.speed}</span>
                  </p>
                </div>
                {bigManExploit.tactics.map((t, i) => (
                  <div key={i} className="pnr-row">
                    <div className="pnr-row-header">
                      <span className="pnr-big">{t.title}</span>
                    </div>
                    <p className="pnr-reason">{t.detail}</p>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}

      {activeTab === 'theirplan' && (
        <div className="analysis-grid">
          <div className="analysis-card">
            <div className="analysis-card-title">What They'll Attack</div>
            <p className="analysis-hint">Weak links on {myTeam} they'll target</p>
            {theirReport.attackTargets.length === 0 && <p className="no-data">Insufficient data</p>}
            {theirReport.attackTargets.map((p, i) => (
              <div key={i} className="analysis-row-block">
                <div className="analysis-row">
                  <span className="analysis-name">
                    {p.name}
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
            <p className="analysis-hint">{opponentTeam}'s weak perimeter defenders — hunt these matchups</p>
            {theirReport.hideTargets.length === 0 && <p className="no-data">Insufficient data</p>}
            {theirReport.hideTargets.map((p, i) => (
              <div key={i} className="analysis-row-block">
                <div className="analysis-row">
                  <span className="analysis-name">
                    {p.name}
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
                    <Avatar className="size-5">
                      {p.playerImage && <AvatarImage src={p.playerImage} alt="" />}
                      <AvatarFallback className="text-[9px]">{p.name?.[0] ?? '?'}</AvatarFallback>
                    </Avatar>
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
          <div className="mb-4 flex flex-col gap-1.5">
            <Label htmlFor="opponent-strategy">Opponent's offensive strategy (optional)</Label>
            <Textarea
              id="opponent-strategy"
              placeholder="e.g. heavy pick and roll with their center, lots of corner 3s, iso-heavy on their best player..."
              value={opponentStrategy}
              onChange={e => setOpponentStrategy(e.target.value)}
              rows={3}
            />
          </div>
          {!planLoading && !gamePlan && (
            <Button className="mt-2" onClick={getAIGamePlan}>Get AI Game Plan</Button>
          )}
          {planLoading && <Spinner label="Generating game plan…" />}
          {planError && <div className="api-error">AI error: {planError}</div>}
          {gamePlan && !planMinimized && (
            <Card className="mt-4 gap-0">
              <CardContent>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="text-xs font-bold tracking-widest uppercase text-muted-foreground">AI Game Plan</div>
                  <Button variant="outline" size="sm" onClick={() => setPlanMinimized(true)}>Minimize</Button>
                </div>
                <p className="game-plan-text">{gamePlan}</p>
                <Button variant="secondary" size="sm" className="mt-3" onClick={getAIGamePlan}>Regenerate</Button>
              </CardContent>
            </Card>
          )}
          {gamePlan && planMinimized && (
            <Card className="mt-4 gap-0">
              <CardContent>
                <div className="mb-1 flex items-center justify-between gap-3">
                  <div className="text-xs font-bold tracking-widest uppercase text-muted-foreground">AI Game Plan (minimized)</div>
                  <Button variant="outline" size="sm" onClick={() => setPlanMinimized(false)}>Expand</Button>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">{summarizePlan(gamePlan)}</p>
              </CardContent>
            </Card>
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
  const [view, setView] = useState('teams')
  const [expandedTeam, setExpandedTeam] = useState(null)

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

  // Same five categories, but ranking individual players across every All-Time roster instead
  // of team averages. Badges relevant to each category (see SPEED_BADGES etc.) boost a player's
  // sort position — e.g. a Speed Boost/Quick First Step guard can out-rank a slightly faster
  // player with no badges — but the number shown is still the raw attribute, not the boosted one.
  const PLAYER_STAT_CATEGORIES = [
    {
      key: 'speed', label: 'Speed', badgeCatalog: SPEED_BADGES,
      eligible: p => (p.positions || []).some(pos => PERIMETER.includes(pos)),
      rawVal: p => p.attributes.speed ?? 0,
    },
    {
      key: 'perimDef', label: 'Perimeter Defense', badgeCatalog: PERIMETER_DEFENSE_BADGES,
      eligible: p => (p.positions || []).some(pos => PERIMETER.includes(pos)),
      rawVal: p => p.attributes.perimeterDefense ?? 0,
    },
    {
      key: 'intDef', label: 'Interior Defense', badgeCatalog: PAINT_DEFENSE_BADGES,
      eligible: p => (p.positions || []).some(pos => BIGS.includes(pos)),
      rawVal: p => p.attributes.interiorDefense ?? 0,
    },
    {
      key: 'three', label: '3PT Shooting', badgeCatalog: THREE_POINT_BADGES,
      eligible: p => (p.positions || []).some(pos => PERIMETER.includes(pos)),
      rawVal: p => p.attributes.threePointShot ?? 0,
    },
    {
      key: 'reb', label: 'Rebounding', badgeCatalog: REBOUNDING_BADGES,
      eligible: () => true,
      rawVal: p => Math.round(((p.attributes.offensiveRebound ?? 0) + (p.attributes.defensiveRebound ?? 0)) / 2),
    },
  ]

  const allPlayers = rosterMap
    ? Object.entries(rosterMap).flatMap(([teamName, roster]) =>
        roster.filter(p => p.attributes).map(p => ({ ...p, team: teamName }))
      )
    : []

  // Real players (LeBron, MJ, etc.) can appear on more than one All-Time franchise roster —
  // dedupe by name within each category and keep only their best-scoring entry, so the same
  // person doesn't occupy two spots in a single top-10 list.
  const playerRankings = rosterMap
    ? PLAYER_STAT_CATEGORIES.map(cat => {
        const bestByName = new Map()
        for (const p of allPlayers.filter(cat.eligible)) {
          const val = cat.rawVal(p)
          if (val <= 0) continue
          const score = val + badgeBoostScore(p, cat.badgeCatalog)
          const existing = bestByName.get(p.name)
          if (!existing || score > existing.score) {
            bestByName.set(p.name, { name: p.name, team: p.team, positions: p.positions, val, score })
          }
        }
        return {
          key: cat.key,
          label: cat.label,
          rows: Array.from(bestByName.values()).sort((a, b) => b.score - a.score).slice(0, 10),
        }
      })
    : []

  return (
    <div className="team-rankings">
      <h2 className="rankings-title">Team Rankings</h2>
      <p className="rankings-subtitle">All-Time teams and players ranked by key stats</p>

      {isLoading && (
        <div className="rankings-loading">
          <Spinner center label={`Loading rosters… ${progress.done} / ${progress.total}`} />
          <Progress value={pct} className="mx-auto mt-3 max-w-xs" />
        </div>
      )}

      {!isLoading && (
        <>
          <Tabs value={view} onValueChange={setView} className="mb-4">
            <TabsList>
              <TabsTrigger value="teams">Teams</TabsTrigger>
              <TabsTrigger value="players">Players</TabsTrigger>
            </TabsList>
          </Tabs>

          {view === 'teams' && (
            <div className="rankings-grid">
              {rankings.map(cat => {
                const max = cat.rows[0]?.val || 1
                return (
                  <Card key={cat.key} className="gap-0">
                    <CardContent>
                      <div className="mb-2 flex items-center justify-between border-b pb-2">
                        <span className="font-mono text-[11px] font-bold tracking-widest text-muted-foreground uppercase">{cat.label}</span>
                        <span className="font-mono text-[11px] font-bold tracking-widest text-muted-foreground uppercase">Avg ↓</span>
                      </div>
                      {cat.rows.map((t, i) => {
                        const logo = teams.find(team => team.teamName === t.name)?.logo
                        const shortName = t.name.replace(/^All-Time /, '')
                        const isOpen = expandedTeam === t.name
                        const roster = rosterMap?.[t.name]
                        const best3pt = isOpen ? bestByAttribute(roster, 'threePointShot') : null
                        const bestPerimDef = isOpen ? bestByAttribute(roster, 'perimeterDefense') : null
                        const bestIntDef = isOpen ? bestByAttribute(roster, 'interiorDefense') : null
                        return (
                          <div key={t.name} className="border-b last:border-b-0">
                            <button
                              type="button"
                              className="flex w-full items-center gap-2.5 py-2 text-left"
                              onClick={() => setExpandedTeam(isOpen ? null : t.name)}
                              aria-expanded={isOpen}
                            >
                              <span className="w-5 shrink-0 text-right font-mono text-xs text-muted-foreground">{i + 1}</span>
                              <Avatar className="size-6 shrink-0 border-0">
                                {logo && <AvatarImage src={logo} alt="" className="object-contain p-0.5" />}
                                <AvatarFallback className="text-[9px]">{shortName[0]}</AvatarFallback>
                              </Avatar>
                              <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{shortName}</span>
                              <span className="hidden h-1 w-16 shrink-0 overflow-hidden rounded-full bg-muted sm:block">
                                <span className="block h-full rounded-full bg-foreground/70" style={{ width: `${Math.round((t.val / max) * 100)}%` }} />
                              </span>
                              <RatingChip value={t.val} />
                              <IconChevronDown className={cn('shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-180')} />
                            </button>
                            {isOpen && (
                              <div className="mb-2 flex flex-col gap-2 rounded-lg bg-muted/60 p-2.5">
                                {[
                                  ['Best 3PT Shooter', best3pt, 'threePointShot'],
                                  ['Best Perimeter Defender', bestPerimDef, 'perimeterDefense'],
                                  ['Best Interior Defender', bestIntDef, 'interiorDefense'],
                                ].map(([label, p, attrKey]) => (
                                  <div key={label}>
                                    <div className="mb-0.5 font-mono text-[10px] font-bold tracking-wide text-muted-foreground uppercase">{label}</div>
                                    {p
                                      ? (
                                        <div className="flex items-center gap-1.5">
                                          <span className="min-w-0 truncate text-[13px] font-medium">{p.name}</span>
                                          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{(p.positions || []).join('/')}</span>
                                          <RatingChip value={p.attributes[attrKey]} className="ml-auto shrink-0" />
                                        </div>
                                      )
                                      : <span className="text-xs text-muted-foreground">No data</span>}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}
                      {cat.rows.length === 0 && <p className="no-data">No data</p>}
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}

          {view === 'players' && (
            <div className="rankings-grid">
              {playerRankings.map(cat => {
                const max = cat.rows[0]?.val || 1
                return (
                  <Card key={cat.key} className="gap-0">
                    <CardContent>
                      <div className="mb-2 flex items-center justify-between border-b pb-2">
                        <span className="font-mono text-[11px] font-bold tracking-widest text-muted-foreground uppercase">{cat.label}</span>
                        <span className="font-mono text-[11px] font-bold tracking-widest text-muted-foreground uppercase">Top 10</span>
                      </div>
                      {cat.rows.map((p, i) => {
                        const logo = teams.find(team => team.teamName === p.team)?.logo
                        const teamShort = p.team.replace(/^All-Time /, '')
                        return (
                          <div key={`${p.name}-${p.team}`} className="flex items-center gap-2.5 border-b py-2 last:border-b-0">
                            <span className="w-5 shrink-0 text-right font-mono text-xs text-muted-foreground">{i + 1}</span>
                            <Avatar className="size-6 shrink-0 border-0">
                              {logo && <AvatarImage src={logo} alt="" className="object-contain p-0.5" />}
                              <AvatarFallback className="text-[9px]">{teamShort[0]}</AvatarFallback>
                            </Avatar>
                            <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                              {p.name}
                              <span className="ml-1.5 font-mono text-[10px] font-normal text-muted-foreground">{(p.positions || []).join('/')}</span>
                            </span>
                            <span className="hidden h-1 w-16 shrink-0 overflow-hidden rounded-full bg-muted sm:block">
                              <span className="block h-full rounded-full bg-foreground/70" style={{ width: `${Math.round((p.val / max) * 100)}%` }} />
                            </span>
                            <RatingChip value={p.val} />
                          </div>
                        )
                      })}
                      {cat.rows.length === 0 && <p className="no-data">No data</p>}
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function HistorySkeleton({ rows = 4 }) {
  return (
    <div className="flex flex-col gap-3" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full rounded-xl" />
      ))}
    </div>
  )
}

function GameplanHistory({ token }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [openId, setOpenId] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetch(`${API_BASE}/api/gameplan/history`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => {
        if (!res.ok) throw new Error(`API error ${res.status}: ${res.statusText}`)
        return res.json()
      })
      .then(data => { if (!cancelled) setItems(data.gameplans || []) })
      .catch(e => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [token])

  if (loading) return <HistorySkeleton />
  if (error) return <div className="api-error center-loading">Failed to load history: {error}</div>

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center text-sm text-muted-foreground">
        <IconHistory size={32} />
        <p>No saved game plans yet — generate one from the Scout tab and it'll show up here.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {items.map(item => (
        <Card
          key={item.id}
          className="cursor-pointer gap-0 transition-colors hover:ring-ring/40"
          onClick={() => setOpenId(openId === item.id ? null : item.id)}
        >
          <CardContent>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold">
                {item.team_a} <span className="font-normal text-muted-foreground">vs</span> {item.team_b}
              </div>
              <div className="text-xs text-muted-foreground">{new Date(item.created_at).toLocaleString()}</div>
            </div>
            {openId === item.id && (
              <>
                <Separator className="mt-3" />
                <p className="game-plan-text mt-3">{item.generated_text}</p>
              </>
            )}
          </CardContent>
        </Card>
      ))}
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

async function attemptSignup(email, password) {
  try {
    const res = await fetch(`${AUTH_BASE}/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    const d = await res.json()
    if (res.ok) return { token: d.token, user: d.user }
    return { error: d.error || 'Failed to create account' }
  } catch {
    return { error: 'Could not reach the auth service' }
  }
}

function Login({ onLogin, theme, onToggleTheme }) {
  const [mode, setMode] = useState('signin') // 'signin' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const isSignup = mode === 'signup'

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = isSignup ? await attemptSignup(email, password) : await attemptLogin(email, password)
    setBusy(false)
    if (res.error) { setError(res.error); return }
    onLogin(res.token, res.user)
  }

  function toggleMode() {
    setMode(m => (m === 'signup' ? 'signin' : 'signup'))
    setError(null)
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <form className="contents" onSubmit={submit}>
          <CardHeader>
            <div className="mb-1 flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-sm font-extrabold text-primary-foreground">2K</span>
              <span className="text-lg font-extrabold tracking-tight">Scout</span>
            </div>
            <CardTitle className="text-xl">{isSignup ? 'Create account' : 'Sign in'}</CardTitle>
            <CardAction>
              <Button
                type="button" variant="outline" size="icon"
                onClick={onToggleTheme} title="Toggle theme"
              >
                {theme === 'light' ? <IconMoon /> : <IconSun />}
              </Button>
            </CardAction>
          </CardHeader>

          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="login-email">Email</Label>
              <Input id="login-email" type="email" autoComplete="username"
                value={email} onChange={e => setEmail(e.target.value)} placeholder="scout@2kscout.app" required />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="login-password">Password</Label>
              <Input id="login-password" type="password" autoComplete={isSignup ? 'new-password' : 'current-password'}
                value={password} onChange={e => setPassword(e.target.value)}
                placeholder={isSignup ? 'At least 6 characters' : '••••••••'} required minLength={isSignup ? 6 : undefined} />
            </div>

            {error && <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
          </CardContent>

          <CardFooter className="flex-col gap-3 border-t-0 bg-transparent">
            <Button type="submit" size="lg" className="w-full" disabled={busy}>
              {busy
                ? (isSignup ? 'Creating account…' : 'Signing in…')
                : (isSignup ? 'Create account' : 'Sign In')}
            </Button>

            <Button type="button" variant="link" size="sm" onClick={toggleMode}>
              {isSignup ? 'Already have an account? Sign in' : "Don't have an account? Create one"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  )
}

function StatCard({ icon, label, value, hint }) {
  return (
    <Card className="gap-0">
      <CardContent>
        <div className="mb-3 flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">{icon}</div>
        <div className="text-2xl font-extrabold">{value}</div>
        <div className="text-sm font-semibold">{label}</div>
        {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  )
}

function DashboardHome({ user, teams, teamsLoading, myTeam, oppTeam, onStart, onRankings }) {
  const ready = myTeam && oppTeam
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-extrabold tracking-tight text-white drop-shadow-sm">Welcome back, {user?.name || 'Scout'}</h2>
        <p className="text-sm text-white/70 drop-shadow-sm">Scout any two All-Time rosters and build a game plan from pure 2K ratings.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={<IconUsers />} label="All-Time Teams" value={teamsLoading ? '—' : teams.length} hint="Available to scout" />
        <StatCard icon={<IconTarget />} label="Current Matchup" value={ready ? 'Ready' : 'None'} hint={ready ? `${myTeam} vs ${oppTeam}` : 'Pick two teams to begin'} />
        <StatCard icon={<IconRankings />} label="Ranking Categories" value="5" hint="Speed · Def · 3PT · Reb" />
        <StatCard icon={<IconBolt />} label="AI Game Plans" value="On" hint="Powered by Claude" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Button size="lg" className="h-auto justify-between rounded-xl p-5 text-left" onClick={onStart}>
          <div>
            <div className="text-[15px] font-bold">Start a Matchup</div>
            <div className="text-[13px] font-normal opacity-80">Select your team and an opponent</div>
          </div>
          <IconArrowRight size={20} />
        </Button>
        <Button variant="outline" size="lg" className="h-auto justify-between rounded-xl p-5 text-left" onClick={onRankings}>
          <div>
            <div className="text-[15px] font-bold">Browse Team Rankings</div>
            <div className="text-[13px] font-normal opacity-80">League-wide stat leaderboards</div>
          </div>
          <IconArrowRight size={20} />
        </Button>
      </div>
    </div>
  )
}

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', Icon: IconDashboard },
  { id: 'scout', label: 'Scout', Icon: IconScout },
  { id: 'rankings', label: 'Rankings', Icon: IconRankings },
  { id: 'history', label: 'History', Icon: IconHistory },
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
    <div className="flex min-h-svh">
      <aside className="sticky top-0 flex h-svh w-[230px] shrink-0 flex-col gap-1.5 border-r bg-card p-4">
        <div className="flex items-center gap-2.5 px-2 pb-5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-sm font-extrabold text-primary-foreground">2K</span>
          <span className="text-[17px] font-extrabold tracking-tight">Scout</span>
        </div>
        <nav className="flex flex-col gap-1">
          {NAV_ITEMS.map(({ id, label, Icon }) => (
            <Button
              key={id}
              variant={page === id ? 'default' : 'ghost'}
              className="justify-start gap-2.5 rounded-lg"
              onClick={() => setPage(id)}
            >
              <Icon /><span>{label}</span>
            </Button>
          ))}
        </nav>
        <Button
          variant="ghost"
          className="mt-auto justify-start gap-2.5 rounded-lg text-muted-foreground hover:text-destructive"
          onClick={handleLogout}
        >
          <IconLogout /><span>Logout</span>
        </Button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b bg-card/80 px-6 py-3 backdrop-blur">
          <h1 className="text-lg font-bold">{pageTitle}</h1>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" onClick={toggleTheme} title="Toggle theme">
              {theme === 'light' ? <IconMoon /> : <IconSun />}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex cursor-pointer items-center gap-2 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                  <Avatar className="size-8 border-0 bg-primary">
                    <AvatarFallback className="bg-primary text-xs text-primary-foreground">{initials}</AvatarFallback>
                  </Avatar>
                  <span className="text-sm font-semibold">{user?.name || 'Scout'}</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                  {user?.email || DEMO_EMAIL}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setPage('settings')}>
                  <IconSettings size={16} /> Settings
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onSelect={handleLogout}>
                  <IconLogout size={16} /> Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="flex-1 p-6">
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
                  opponentRoster={oppRoster} opponentTeam={oppTeam} token={token} teams={teams} />
              )}
            </>
          )}

          {page === 'rankings' && (
            <TeamRankings teams={teams} teamsLoading={teamsLoading} />
          )}

          {page === 'history' && (
            <GameplanHistory token={token} />
          )}

          {page === 'settings' && (
            <div className="mx-auto flex max-w-xl flex-col gap-4">
              <Card className="gap-0">
                <CardContent>
                  <div className="mb-3 text-xs font-bold tracking-widest uppercase text-muted-foreground">Appearance</div>
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-sm font-semibold">Theme</div>
                      <div className="text-xs text-muted-foreground">Switch between light and dark mode</div>
                    </div>
                    <Button variant="outline" size="sm" onClick={toggleTheme}>
                      {theme === 'light' ? <><IconMoon size={16} /> Dark</> : <><IconSun size={16} /> Light</>}
                    </Button>
                  </div>
                </CardContent>
              </Card>
              <Card className="gap-0">
                <CardContent>
                  <div className="mb-3 text-xs font-bold tracking-widest uppercase text-muted-foreground">Account</div>
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-sm font-semibold">{user?.name || 'Scout'}</div>
                      <div className="text-xs text-muted-foreground">{user?.email || DEMO_EMAIL}</div>
                    </div>
                    <Button variant="outline" size="sm" className="hover:border-destructive hover:text-destructive" onClick={handleLogout}>
                      <IconLogout size={16} /> Logout
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
