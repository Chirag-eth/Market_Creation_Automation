import { useState, useEffect, useRef } from 'react'
import { fetchLeagues, fetchFixtures } from '../api.js'

function fmtKickoff(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })
    + ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) + ' UTC'
}

function SelectAllCheckbox({ fixtures, selectedIds, onSelectAll, onClearAll }) {
  const ref = useRef(null)
  const total    = fixtures.length
  const selCount = fixtures.filter(f => selectedIds.has(f.providerFixtureId || f.fixture_id)).length
  const allIn    = total > 0 && selCount === total
  const someIn   = selCount > 0 && selCount < total

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = someIn
  }, [someIn])

  function handleChange() {
    if (allIn || someIn) onClearAll()
    else onSelectAll(fixtures)
  }

  return (
    <div className="fix-select-bar">
      <input
        ref={ref}
        type="checkbox"
        className="cb"
        checked={allIn}
        onChange={handleChange}
        disabled={total === 0}
      />
      <span className="fix-select-bar__label">Select all</span>
      {selCount > 0 && (
        <span className="fix-select-bar__count">{selCount} selected</span>
      )}
    </div>
  )
}

export default function SchedulePanel({ activeEnv, selectedIds, onToggle, onSelectAll, onClearAll }) {
  const [leagues,        setLeagues]        = useState([])
  const [activeLeague,   setActiveLeague]   = useState(null)
  const [fixtures,       setFixtures]       = useState([])
  const [loadingLeagues, setLoadingLeagues] = useState(true)
  const [loadingFix,     setLoadingFix]     = useState(false)
  const [error,          setError]          = useState(null)

  const envCode = activeEnv?.code ?? null

  useEffect(() => {
    setLoadingLeagues(true)
    setLeagues([])
    setActiveLeague(null)
    fetchLeagues()
      .then(list => {
        setLeagues(list)
        if (list.length) setActiveLeague(list[0].code)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoadingLeagues(false))
  }, [envCode])

  useEffect(() => {
    if (!activeLeague) return
    setLoadingFix(true)
    setFixtures([])
    setError(null)
    fetchFixtures(activeLeague)
      .then(payload => setFixtures(Array.isArray(payload.fixtures) ? payload.fixtures : []))
      .catch(e => setError(e.message))
      .finally(() => setLoadingFix(false))
  }, [activeLeague])

  function enrichFixture(f) {
    const id        = f.providerFixtureId || f.fixture_id
    const kickoff   = f.kickoffIso || `${f.fixtureDate}T${f.kickoffTimeUtc}:00Z`
    return { ...f, id, kickoff, leagueCode: activeLeague }
  }

  function handleToggle(f) {
    onToggle(enrichFixture(f))
  }

  function handleSelectAll(allFixtures) {
    onSelectAll(allFixtures.map(enrichFixture))
  }

  function handleClearAll() {
    onClearAll()
  }

  const selCount = selectedIds.size

  return (
    <div className="spanel-right">
      <div className="spanel-right__hdr">
        <span className="spanel-right__title">Schedule</span>
        {loadingLeagues && <span className="spanel-right__hint">Loading leagues…</span>}
        {selCount > 0 && !loadingLeagues && (
          <span className="spanel-right__sel">
            {selCount} fixture{selCount !== 1 ? 's' : ''} selected
          </span>
        )}
      </div>

      {leagues.length > 0 && (
        <div className="league-tabs">
          {leagues.map(l => (
            <button
              key={l.code}
              className={`league-tab${activeLeague === l.code ? ' league-tab--active' : ''}`}
              onClick={() => setActiveLeague(l.code)}
            >
              {l.label}
            </button>
          ))}
        </div>
      )}

      {!loadingFix && !error && fixtures.length > 0 && (
        <SelectAllCheckbox
          fixtures={fixtures}
          selectedIds={selectedIds}
          onSelectAll={handleSelectAll}
          onClearAll={handleClearAll}
        />
      )}

      <div className="spanel-right__fixtures">
        {loadingFix && <div className="spanel-right__empty">Loading…</div>}
        {error && <div className="spanel-right__empty spanel-right__empty--err">{error}</div>}
        {!loadingFix && !error && fixtures.length === 0 && (
          <div className="spanel-right__empty">No upcoming fixtures</div>
        )}
        {fixtures.map(f => {
          const id       = f.providerFixtureId || f.fixture_id
          const isActive = selectedIds.has(id)
          const kickoff  = f.kickoffIso || `${f.fixtureDate}T${f.kickoffTimeUtc}:00Z`
          return (
            <div
              key={id}
              className={`fix-row${isActive ? ' fix-row--active' : ''}`}
              onClick={() => handleToggle(f)}
            >
              <input
                type="checkbox"
                className="cb fix-row__cb"
                checked={isActive}
                onChange={() => handleToggle(f)}
                onClick={e => e.stopPropagation()}
              />
              <div className="fix-row__content">
                <div className="fix-row__match">
                  {f.homeTeamName} <span className="fix-row__vs">vs</span> {f.awayTeamName}
                </div>
                <div className="fix-row__meta">{fmtKickoff(kickoff)}</div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
