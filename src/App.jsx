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

      {loading && <div className="loading">Loading roster…</div>}
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

  // Roster already contains attributes + badges — no second fetch needed

  const PERIMETER = ['PG', 'SG', 'SF']
  const isPerimeter = p => (p.positions || []).some(pos => PERIMETER.includes(pos))

  const attackTargets = [...opponentRoster]
    .filter(p => p.attributes)
    .map(p => ({
      name: p.name,
      perim: p.attributes.perimeterDefense ?? 99,
      interior: p.attributes.interiorDefense ?? 99,
    }))
    .sort((a, b) => (a.perim + a.interior) - (b.perim + b.interior))
    .slice(0, 3)

  const hideTargets = [...myRoster]
    .filter(p => p.attributes && isPerimeter(p))
    .map(p => ({ name: p.name, perim: p.attributes.perimeterDefense ?? 99 }))
    .sort((a, b) => a.perim - b.perim)
    .slice(0, 3)

  const leaveOpen = [...opponentRoster]
    .filter(p => p.attributes && isPerimeter(p))
    .map(p => ({
      name: p.name,
      three: p.attributes.threePointShot ?? 99,
      mid: p.attributes.midRangeShot ?? 99,
    }))
    .sort((a, b) => (a.three + a.mid) - (b.three + b.mid))
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

  const BIGS = ['C', 'PF']
  const bestMatchups = [...opponentRoster]
    .sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0))
    .slice(0, 5)
    .map(threat => {
      const oppPos = threat.positions || []
      const isBig = oppPos.some(p => BIGS.includes(p))
      const defStat = isBig ? 'interiorDefense' : 'perimeterDefense'
      const statLabel = isBig ? 'ID' : 'PD'

      const samePos = myRoster.filter(p => p.attributes && (p.positions || []).some(pos => oppPos.includes(pos)))
      const pool = samePos.length > 0 ? samePos : myRoster.filter(p => p.attributes)
      const defender = [...pool].sort((a, b) => (b.attributes[defStat] ?? 0) - (a.attributes[defStat] ?? 0))[0]

      return defender ? {
        threat: threat.name,
        threatOverall: threat.overall,
        threatPos: oppPos[0],
        defender: defender.name,
        defValue: defender.attributes[defStat] ?? '—',
        statLabel,
      } : null
    })
    .filter(Boolean)

  async function getAIGamePlan() {
    setPlanLoading(true)
    setPlanError(null)
    setGamePlan(null)
    try {
      const res = await fetch(LAMBDA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ myTeam, opponentTeam, attackTargets, hideTargets, leaveOpen }),
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

  return (
    <div className="matchup-analyzer">
      <h2 className="analyzer-title">Matchup Analyzer</h2>
      <p className="analyzer-subtitle">{myTeam} vs {opponentTeam}</p>

      {!planLoading && !gamePlan && (
        <button className="analyze-btn ai-plan-btn" onClick={getAIGamePlan}>
          Get AI Game Plan
        </button>
      )}
      {planLoading && <div className="loading">Generating game plan…</div>}
      {planError && <div className="api-error">AI error: {planError}</div>}
      {gamePlan && (
        <div className="game-plan">
          <div className="game-plan-title">AI Game Plan</div>
          <p className="game-plan-text">{gamePlan}</p>
          <button className="analyze-btn ai-plan-btn ai-plan-regen" onClick={getAIGamePlan}>Regenerate</button>
        </div>
      )}

      <div className="analysis-grid">
        <div className="analysis-card">
          <div className="analysis-card-title">Attack Offensively</div>
          <p className="analysis-hint">Weakest defenders on {opponentTeam}</p>
          {attackTargets.length === 0 && <p className="no-data">Insufficient data</p>}
          {attackTargets.map((p, i) => (
            <div key={i} className="analysis-row">
              <span className="analysis-name">{p.name}</span>
              <span className="analysis-stats">
                <span style={{ color: getRatingColor(p.perim) }}>PD {p.perim}</span>
                {' / '}
                <span style={{ color: getRatingColor(p.interior) }}>ID {p.interior}</span>
              </span>
            </div>
          ))}
        </div>

        <div className="analysis-card">
          <div className="analysis-card-title">Hide Defensively</div>
          <p className="analysis-hint">Weakest defenders on {myTeam} — keep off the ball</p>
          {hideTargets.length === 0 && <p className="no-data">Insufficient data</p>}
          {hideTargets.map((p, i) => (
            <div key={i} className="analysis-row">
              <span className="analysis-name">{p.name}</span>
              <span className="analysis-stats">
                <span style={{ color: getRatingColor(p.perim) }}>PD {p.perim}</span>
              </span>
            </div>
          ))}
        </div>

        <div className="analysis-card">
          <div className="analysis-card-title">Leave Open</div>
          <p className="analysis-hint">Worst shooters on {opponentTeam} — sag off to help elsewhere</p>
          {leaveOpen.length === 0 && <p className="no-data">Insufficient data</p>}
          {leaveOpen.map((p, i) => (
            <div key={i} className="analysis-row">
              <span className="analysis-name">{p.name}</span>
              <span className="analysis-stats">
                <span style={{ color: getRatingColor(p.three) }}>3PT {p.three}</span>
                {' / '}
                <span style={{ color: getRatingColor(p.mid) }}>MID {p.mid}</span>
              </span>
            </div>
          ))}
        </div>

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
    </div>
  )
}

export default function App() {
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

      {teamsLoading && <div className="loading center-loading">Loading teams…</div>}
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
    </div>
  )
}
