import { useState, useEffect, useCallback } from 'react'
import './App.css'

const API_KEY = '2k_e55epjrp3x2oqtkam4ukk4yklystt5cb'
const BASE_URL = ''
const LAMBDA_URL = 'YOUR_LAMBDA_URL_HERE'

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
  if (t === 'hall of fame' || t === 'hof' || t === 'legend') return '#f59e0b'
  if (t === 'gold') return '#eab308'
  if (t === 'silver') return '#94a3b8'
  if (t === 'bronze') return '#92400e'
  return '#9ca3af'
}

function getBadgeTierLabel(tier) {
  if (!tier) return tier
  const t = tier.toLowerCase()
  if (t === 'hall of fame' || t === 'hof') return 'HoF'
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
  if (badges === null) {
    return <p className="badge-unavailable">Badge data unavailable for this player.</p>
  }
  if (!Array.isArray(badges) || badges.length === 0) {
    return <p className="badge-unavailable">No badges.</p>
  }

  const tierOrder = ['hall of fame', 'hof', 'legend', 'gold', 'silver', 'bronze']
  const sorted = [...badges].sort((a, b) => {
    const ta = (a.tier || '').toLowerCase()
    const tb = (b.tier || '').toLowerCase()
    const ia = tierOrder.findIndex(t => ta.includes(t))
    const ib = tierOrder.findIndex(t => tb.includes(t))
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
          {badge.name || badge.badge_name || badge.label || JSON.stringify(badge)}
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
                <StatGroup title="Offense" stats={OFFENSE_STATS} playerData={detail} />
                <StatGroup title="Defense" stats={DEFENSE_STATS} playerData={detail} />
                <StatGroup title="Athletic" stats={ATHLETIC_STATS} playerData={detail} />
              </div>

              <div className="badges-section">
                <div className="badges-title">Badges</div>
                <BadgeList badges={detail.badges !== undefined ? detail.badges : null} />
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

function MatchupAnalyzer({ myRoster, myTeam, opponentRoster, opponentTeam }) {
  const [myDetails, setMyDetails] = useState({})
  const [oppDetails, setOppDetails] = useState({})
  const [loading, setLoading] = useState(false)
  const [fetched, setFetched] = useState(false)
  const [error, setError] = useState(null)
  const [gamePlan, setGamePlan] = useState(null)
  const [planLoading, setPlanLoading] = useState(false)
  const [planError, setPlanError] = useState(null)

  const fetchAllDetails = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const fetchRoster = async (roster, teamName) => {
        const results = {}
        for (const player of roster) {
          const slug = player.slug || player.name?.toLowerCase().replace(/\s+/g, '-')
          try {
            const res = await apiFetch(`/api/players/slug/${slug}?teamType=allt&team=${encodeURIComponent(teamName)}`)
            results[slug] = res.data ?? res
          } catch {
            // skip failed players
          }
        }
        return results
      }
      const [myD, oppD] = await Promise.all([
        fetchRoster(myRoster, myTeam),
        fetchRoster(opponentRoster, opponentTeam),
      ])
      setMyDetails(myD)
      setOppDetails(oppD)
      setFetched(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [myRoster, myTeam, opponentRoster, opponentTeam])

  const myDetailsList = Object.values(myDetails)
  const oppDetailsList = Object.values(oppDetails)

  const attackTargets = oppDetailsList.length
    ? [...oppDetailsList]
        .filter(p => p.perimeterDefense !== undefined || p.interiorDefense !== undefined)
        .map(p => ({
          name: p.name,
          perim: parseInt(p.perimeterDefense) || 99,
          interior: parseInt(p.interiorDefense) || 99,
        }))
        .sort((a, b) => (a.perim + a.interior) - (b.perim + b.interior))
        .slice(0, 3)
    : []

  const hideTargets = myDetailsList.length
    ? [...myDetailsList]
        .filter(p => p.perimeterDefense !== undefined)
        .map(p => ({ name: p.name, perim: parseInt(p.perimeterDefense) || 99 }))
        .sort((a, b) => a.perim - b.perim)
        .slice(0, 3)
    : []

  const myAdvantages = []
  const oppAdvantages = []

  async function getAIGamePlan() {
    setPlanLoading(true)
    setPlanError(null)
    setGamePlan(null)
    try {
      const res = await fetch(LAMBDA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          myTeam,
          opponentTeam,
          attackTargets,
          hideTargets,
          myAdvantages,
          oppAdvantages,
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

  return (
    <div className="matchup-analyzer">
      <h2 className="analyzer-title">Matchup Analyzer</h2>
      <p className="analyzer-subtitle">
        {myTeam} vs {opponentTeam}
      </p>

      {!fetched && !loading && (
        <button className="analyze-btn" onClick={fetchAllDetails}>
          Run Full Analysis
        </button>
      )}

      {loading && <div className="loading">Fetching full rosters for analysis…</div>}
      {error && <div className="api-error">Error: {error}</div>}

      {fetched && !planLoading && !gamePlan && (
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
          <button className="analyze-btn ai-plan-btn ai-plan-regen" onClick={getAIGamePlan}>
            Regenerate
          </button>
        </div>
      )}

      {fetched && (
        <div className="analysis-grid">
          <div className="analysis-card">
            <div className="analysis-card-title">Attack Offensively</div>
            <p className="analysis-hint">Lowest combined perimeter + interior defense on {opponentTeam}</p>
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
            <p className="analysis-hint">Lowest perimeter defense on {myTeam} — keep away from ball handlers</p>
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

          <div className="analysis-card analysis-card--badges">
            <div className="analysis-card-title">Badge Advantages</div>
            <div className="badge-advantage-section">
              <div className="badge-adv-label">{myTeam} has (opponent lacks):</div>
              {myAdvantages.length === 0 && <p className="no-data">No exclusive HoF/Gold badges</p>}
              {myAdvantages.map(([name, info], i) => (
                <div key={i} className="badge-adv-row">
                  <span className="badge-chip small" style={{ borderColor: getBadgeTierColor(info.tier), color: getBadgeTierColor(info.tier) }}>
                    {name} · {getBadgeTierLabel(info.tier)}
                  </span>
                  <span className="badge-adv-player">{info.player}</span>
                </div>
              ))}
            </div>
            <div className="badge-advantage-section">
              <div className="badge-adv-label">{opponentTeam} has (you lack):</div>
              {oppAdvantages.length === 0 && <p className="no-data">No exclusive HoF/Gold badges</p>}
              {oppAdvantages.map(([name, info], i) => (
                <div key={i} className="badge-adv-row">
                  <span className="badge-chip small" style={{ borderColor: getBadgeTierColor(info.tier), color: getBadgeTierColor(info.tier) }}>
                    {name} · {getBadgeTierLabel(info.tier)}
                  </span>
                  <span className="badge-adv-player">{info.player}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
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
