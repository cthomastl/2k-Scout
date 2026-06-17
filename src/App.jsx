import { useState, useEffect } from 'react'
import './App.css'

const API_KEY = import.meta.env.VITE_NBA2K_API_KEY ?? ''
const BASE_URL = ''
const LAMBDA_URL = import.meta.env.VITE_LAMBDA_URL ?? ''

async function apiFetch(path) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'X-API-Key': API_KEY },
  })
  if (!res.ok) throw new Error(`API error ${res.status}: ${res.statusText}`)
  return res.json()
}

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

function MatchupAnalyzer({ myRoster, myTeam, opponentRoster, opponentTeam }) {
  const [gamePlan, setGamePlan] = useState(null)
  const [planLoading, setPlanLoading] = useState(false)
  const [planError, setPlanError] = useState(null)
  const [activeTab, setActiveTab] = useState('scouting')
  const [opponentStrategy, setOpponentStrategy] = useState('')

  const isPerimeter = p => (p.positions || []).some(pos => PERIMETER.includes(pos))
  const isBig = p => (p.positions || []).some(pos => BIGS.includes(pos))

  const attackTargets = [...opponentRoster]
    .filter(p => p.attributes)
    .map(p => {
      const pos = p.positions || []
      const isB = pos.some(pp => BIGS.includes(pp))
      const perim = p.attributes.perimeterDefense ?? 99
      const interior = p.attributes.interiorDefense ?? 99
      let attackHint
      if (isB) {
        attackHint = perim <= interior
          ? 'stretch big — low PD means cannot guard on perimeter; use a shooter to pull them away from the paint'
          : 'paint target — low interior defense; post up or attack the basket against them'
      } else {
        attackHint = 'ISO/drive target — low perimeter defense; blow past them on the wing or in isolation'
      }
      return { name: p.name, archetype: p.archetype, positions: pos, perim, interior, attackHint }
    })
    .sort((a, b) => (a.perim + a.interior) - (b.perim + b.interior))
    .slice(0, 3)

  const hideTargets = [...myRoster]
    .filter(p => p.attributes && isPerimeter(p))
    .map(p => ({ name: p.name, archetype: p.archetype, perim: p.attributes.perimeterDefense ?? 99 }))
    .sort((a, b) => a.perim - b.perim)
    .slice(0, 3)

  const leaveOpen = [...opponentRoster]
    .filter(p => p.attributes && isPerimeter(p))
    .map(p => ({
      name: p.name,
      archetype: p.archetype,
      three: p.attributes.threePointShot ?? 99,
      mid: p.attributes.midRangeShot ?? 99,
    }))
    .filter(p => p.three < 80)
    .sort((a, b) => (a.three + a.mid) - (b.three + b.mid))
    .slice(0, 3)

  const speedAdvantage = [...myRoster]
    .filter(p => p.attributes && isPerimeter(p))
    .map(myP => {
      const oppPos = myP.positions || []
      const oppMatch = [...opponentRoster]
        .filter(p => p.attributes && (p.positions || []).some(pos => oppPos.includes(pos)))
        .sort((a, b) => (a.attributes.speed ?? 0) - (b.attributes.speed ?? 0))[0]
      if (!oppMatch) return null
      const diff = (myP.attributes.speed ?? 0) - (oppMatch.attributes.speed ?? 0)
      return diff >= 8 ? {
        myPlayer: myP.name,
        mySpeed: myP.attributes.speed,
        oppPlayer: oppMatch.name,
        oppSpeed: oppMatch.attributes.speed,
        diff,
      } : null
    })
    .filter(Boolean)
    .sort((a, b) => b.diff - a.diff)
    .slice(0, 3)

  const clutchPlayers = [...myRoster]
    .filter(p => p.attributes)
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
  const myTopPlayers = [...myRoster]
    .sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0))
    .slice(0, 5)
    .map(p => ({
      name: p.name,
      overall: p.overall,
      badges: dedupeByName(p.badges?.list).filter(b =>
        HOF_TIERS.some(t => (b.tier || '').toLowerCase().includes(t))
      ),
    }))

  const bestMatchups = (() => {
    const threats = [...opponentRoster]
      .sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0))
      .slice(0, 5)
    const usedDefenders = new Set()
    return threats.map(threat => {
      const oppPos = threat.positions || []
      const isBig = oppPos.some(p => BIGS.includes(p))
      // Stretch bigs (PF/C with 3PT ≥ 78) need a perimeter defender, not a shot blocker
      const isStretchBig = isBig && (threat.attributes?.threePointShot ?? 0) >= 78
      const big = isBig && !isStretchBig
      const defStat = big ? 'interiorDefense' : 'perimeterDefense'
      const statLabel = big ? 'Interior Defense' : 'Perimeter Defense'

      const samePos = myRoster.filter(p => p.attributes && !usedDefenders.has(p.name) && (p.positions || []).some(pos => oppPos.includes(pos)))
      const pool = samePos.length > 0 ? samePos : myRoster.filter(p => p.attributes && !usedDefenders.has(p.name))
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

      const myKeyPlayers = [...myRoster]
        .sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0))
        .slice(0, 5)
        .map(p => ({ name: p.name, overall: p.overall, archetype: p.archetype, positions: p.positions, badges: topBadges(p) }))

      const oppKeyPlayers = [...opponentRoster]
        .sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0))
        .slice(0, 5)
        .map(p => ({ name: p.name, overall: p.overall, archetype: p.archetype, positions: p.positions, badges: topBadges(p) }))

      const res = await fetch(LAMBDA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          myTeam, opponentTeam,
          attackTargets, hideTargets, leaveOpen,
          speedAdvantage, bestMatchups,
          myKeyPlayers, oppKeyPlayers,
          opponentStrategy: opponentStrategy.trim(),
        }),
      })
      if (!res.ok) throw new Error(`Lambda error ${res.status}`)
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setGamePlan(data.gamePlan)
    } catch (e) {
      setPlanError(e.message)
    } finally {
      setPlanLoading(false)
    }
  }

  // Lineup combinations
  const withAttrs = myRoster.filter(p => p.attributes)
  const isBigP = p => (p.positions || []).some(pos => BIGS.includes(pos))

  const closingLineup = [...withAttrs]
    .sort((a, b) => ((b.attributes.shotIQ??0) + (b.attributes.offensiveConsistency??0) + (b.overall??0)*0.5) -
                    ((a.attributes.shotIQ??0) + (a.attributes.offensiveConsistency??0) + (a.overall??0)*0.5))
    .slice(0, 5)

  const paceLineup = [...withAttrs]
    .sort((a, b) => ((b.attributes.speed??0) + (b.attributes.threePointShot??0)*1.2) -
                    ((a.attributes.speed??0) + (a.attributes.threePointShot??0)*1.2))
    .slice(0, 5)

  const lockdownLineup = [...withAttrs]
    .sort((a, b) => ((b.attributes.perimeterDefense??0) + (b.attributes.interiorDefense??0) + (b.attributes.steal??0) + (b.attributes.block??0)) -
                    ((a.attributes.perimeterDefense??0) + (a.attributes.interiorDefense??0) + (a.attributes.steal??0) + (a.attributes.block??0)))
    .slice(0, 5)

  const bigPool = [...withAttrs].filter(isBigP).sort((a, b) => (b.overall??0) - (a.overall??0)).slice(0, 2)
  const bigNames = new Set(bigPool.map(p => p.name))
  const twinTowersLineup = [...bigPool, ...[...withAttrs].filter(p => !bigNames.has(p.name)).sort((a, b) => (b.overall??0) - (a.overall??0)).slice(0, 3)]

  const shooterLineup = (() => {
    const sorted = [...withAttrs].sort((a, b) => (b.attributes.threePointShot ?? 0) - (a.attributes.threePointShot ?? 0))
    const slots = ['PG', 'SG', 'SF', 'PF', 'C']
    const used = new Set()
    const result = []
    for (const slot of slots) {
      const match = sorted.find(p => !used.has(p.name) && (p.positions || []).includes(slot))
      if (match) { used.add(match.name); result.push(match) }
    }
    // fill any remaining slots from the sorted pool
    for (const p of sorted) {
      if (result.length >= 5) break
      if (!used.has(p.name)) { used.add(p.name); result.push(p) }
    }
    return result
  })()

  const lineups = [
    { name: 'Closing Lineup', desc: 'High-IQ players for tight fourth-quarter situations', players: closingLineup,
      getStat: p => ({ label: 'Shot IQ', val: p.attributes.shotIQ ?? '—' }) },
    { name: 'Pace & Space', desc: 'Push tempo and stretch the floor with speed and shooting', players: paceLineup,
      getStat: p => ({ label: 'Speed', val: p.attributes.speed ?? '—' }) },
    { name: 'Sharpshooters', desc: 'Best 3PT shooters to space the floor and punish close-outs', players: shooterLineup,
      getStat: p => ({ label: '3PT', val: p.attributes.threePointShot ?? '—' }) },
    { name: 'Lockdown', desc: 'Maximum defensive pressure across all positions', players: lockdownLineup,
      getStat: p => ({ label: isBigP(p) ? 'Int. Def' : 'Per. Def', val: (isBigP(p) ? p.attributes.interiorDefense : p.attributes.perimeterDefense) ?? '—' }) },
    { name: 'Twin Towers', desc: 'Two bigs for interior dominance and paint presence', players: twinTowersLineup,
      getStat: p => ({ label: isBigP(p) ? 'Int. Def' : 'Speed', val: (isBigP(p) ? p.attributes.interiorDefense : p.attributes.speed) ?? '—' }) },
  ]

  const edges = computeMatchupEdges(myRoster, opponentRoster)
  const TABS = [
    { id: 'scouting', label: 'Scouting' },
    { id: 'matchups', label: 'Matchups' },
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
            <p className="analysis-hint">Weakest defenders on {opponentTeam}</p>
            {attackTargets.length === 0 && <p className="no-data">Insufficient data</p>}
            {attackTargets.map((p, i) => (
              <div key={i} className="analysis-row">
                <span className="analysis-name">{p.name}</span>
                <span className="analysis-stats">
                  <span style={{ color: getRatingColor(p.perim) }}>Per. Def {p.perim}</span>
                  {' / '}
                  <span style={{ color: getRatingColor(p.interior) }}>Int. Def {p.interior}</span>
                </span>
              </div>
            ))}
          </div>

          <div className="analysis-card">
            <div className="analysis-card-title">Hide Defensively</div>
            <p className="analysis-hint">Weakest perimeter defenders on {myTeam}</p>
            {hideTargets.length === 0 && <p className="no-data">Insufficient data</p>}
            {hideTargets.map((p, i) => (
              <div key={i} className="analysis-row">
                <span className="analysis-name">{p.name}</span>
                <span className="analysis-stats">
                  <span style={{ color: getRatingColor(p.perim) }}>Per. Def {p.perim}</span>
                </span>
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
                    {m.myPlayer}
                    <span style={{ color: getRatingColor(m.mySpeed), marginLeft: 6, fontSize: 12 }}>Speed {m.mySpeed}</span>
                  </span>
                  <span className="matchup-arrow">vs</span>
                  <span className="matchup-defender">
                    {m.oppPlayer}
                    <span style={{ color: getRatingColor(m.oppSpeed), marginLeft: 6, fontSize: 12 }}>Speed {m.oppSpeed}</span>
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
          {gamePlan && (
            <div className="game-plan">
              <div className="game-plan-title">AI Game Plan</div>
              <p className="game-plan-text">{gamePlan}</p>
              <button className="analyze-btn ai-plan-regen" onClick={getAIGamePlan}>Regenerate</button>
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

export default function App() {
  const [appTab, setAppTab] = useState('scout')
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
    apiFetch('/api/teams?teamType=allt')
      .then(data => {
        console.log('Teams response:', JSON.stringify(data, null, 2))
        const list = Array.isArray(data) ? data : data.data || data.teams || []
        setTeams(list)
      })
      .catch(e => setTeamsError(e.message))
      .finally(() => setTeamsLoading(false))
  }, [])

  async function fetchRoster(teamName, setRoster, setLoading, setError) {
    if (!teamName) return
    setLoading(true)
    setError(null)
    setRoster([])
    try {
      const data = await apiFetch(`/api/teams/${encodeURIComponent(teamName)}/roster?teamType=allt`)
      console.log(`Roster for ${teamName}:`, JSON.stringify(data, null, 2))
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

  const bothSelected = myTeam && oppTeam && myRoster.length > 0 && oppRoster.length > 0

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">2K Scout</h1>
        <p className="app-subtitle">Pre-game scouting for NBA 2K All-Time teams</p>
      </header>

      <div className="app-nav">
        <button className={`app-nav-tab${appTab === 'scout' ? ' active' : ''}`} onClick={() => setAppTab('scout')}>Scout</button>
        <button className={`app-nav-tab${appTab === 'rankings' ? ' active' : ''}`} onClick={() => setAppTab('rankings')}>Team Rankings</button>
      </div>

      {appTab === 'scout' && (
        <>
          {teamsLoading && <Spinner center label="Loading teams…" />}
          {teamsError && <div className="api-error center-loading">Failed to load teams: {teamsError}</div>}

          {!teamsLoading && (
            <div className="panels-container">
              <TeamPanel
                side="my"
                selectedTeam={myTeam}
                onTeamChange={handleMyTeamChange}
                teams={teams}
                roster={myRoster}
                loading={myRosterLoading}
                error={myRosterError}
              />
              <TeamPanel
                side="opp"
                selectedTeam={oppTeam}
                onTeamChange={handleOppTeamChange}
                teams={teams}
                roster={oppRoster}
                loading={oppRosterLoading}
                error={oppRosterError}
              />
            </div>
          )}

          {bothSelected && (
            <MatchupAnalyzer
              myRoster={myRoster}
              myTeam={myTeam}
              opponentRoster={oppRoster}
              opponentTeam={oppTeam}
            />
          )}
        </>
      )}

      {appTab === 'rankings' && (
        <TeamRankings teams={teams} teamsLoading={teamsLoading} />
      )}
    </div>
  )
}
