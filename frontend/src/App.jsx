import { useState, useMemo, useEffect } from 'react'
import { submarketGroups, ALL_SUBMARKET_IDS } from './data.js'
import { useFixtures } from './hooks/useFixtures.js'
import { publishBatch, fetchBatchRun, fetchEnvironment, switchEnvironment } from './api.js'
import { useTheme } from './hooks/useTheme.js'
import Header         from './components/Header.jsx'
import TabBar         from './components/TabBar.jsx'
import BuilderView    from './components/BuilderView.jsx'
import FilterBar      from './components/FilterBar.jsx'
import FixtureTable   from './components/FixtureTable.jsx'
import SubmarketPanel from './components/SubmarketPanel.jsx'
import SelectionBar   from './components/SelectionBar.jsx'
import ReviewOverlay  from './components/ReviewOverlay.jsx'
import ScheduleQueue  from './components/ScheduleQueue.jsx'
import JsonView       from './components/JsonView.jsx'

export default function App() {
  const { theme, toggle: toggleTheme } = useTheme()
  const { fixtures, loading, error } = useFixtures()

  const [activeEnv,   setActiveEnv]   = useState(null)
  const [environments, setEnvironments] = useState([])

  useEffect(() => {
    fetchEnvironment()
      .then(data => {
        setActiveEnv(data.active_env)
        setEnvironments(data.environments || [])
      })
      .catch(() => {})
  }, [])

  async function handleSwitchEnv(code) {
    try {
      const data = await switchEnvironment(code)
      setActiveEnv(data.active_env)
      setEnvironments(data.environments || [])
    } catch {}
  }

  const [tab,             setTab]             = useState('builder')
  const [builderSelection, setBuilderSelection] = useState(new Map()) // id -> fixture
  const [builderPublishSuccess, setBuilderPublishSuccess] = useState(false)
  const [submarkets,      setSubmarkets]      = useState(new Set())
  const [selected,        setSelected]        = useState(new Set())
  const [filters,         setFilters]         = useState({ league: '', date: '', matchday: '', search: '' })
  const [sort,            setSort]            = useState({ field: 'kickoff', dir: 'asc' })
  const [view,            setView]            = useState('list')
  const [queueOpen,       setQueueOpen]       = useState(false)
  const [scheduledJobs,   setScheduledJobs]   = useState([])
  const [lastScheduledAt, setLastScheduledAt] = useState(null)
  const [lastActionMarkets, setLastActionMarkets] = useState(0)
  const [publishError,    setPublishError]    = useState(null)
  const [publishing,      setPublishing]      = useState(false)

  const filtered = useMemo(() => {
    return fixtures
      .filter(f => {
        if (filters.league   && f.league !== filters.league)                   return false
        if (filters.date     && !f.kickoff.startsWith(filters.date))          return false
        if (filters.matchday && f.matchday !== parseInt(filters.matchday, 10)) return false
        if (filters.search) {
          const q = filters.search.toLowerCase()
          if (!f.home.toLowerCase().includes(q) &&
              !f.away.toLowerCase().includes(q) &&
              !f.league.toLowerCase().includes(q)) return false
        }
        return true
      })
      .sort((a, b) => {
        const aV = sort.field === 'kickoff' ? new Date(a.kickoff).getTime() : 0
        const bV = sort.field === 'kickoff' ? new Date(b.kickoff).getTime() : 0
        return sort.dir === 'asc' ? aV - bV : bV - aV
      })
  }, [fixtures, filters, sort])

  const scheduledFixtureIds = useMemo(() => {
    const ids = new Set()
    scheduledJobs.filter(j => j.status === 'pending').forEach(j => j.fixtures.forEach(f => ids.add(f.id)))
    return ids
  }, [scheduledJobs])

  const builderSelectedIds = useMemo(() => new Set(builderSelection.keys()), [builderSelection])

  function handleToggleBuilderFixture(fixture) {
    setBuilderSelection(prev => {
      const next = new Map(prev)
      next.has(fixture.id) ? next.delete(fixture.id) : next.set(fixture.id, fixture)
      return next
    })
  }

  function handleSelectAllBuilderFixtures(fixtures) {
    setBuilderSelection(new Map(fixtures.map(f => [f.id, f])))
  }

  function handleClearBuilderFixtures() {
    setBuilderSelection(new Map())
  }

  async function handleBuilderPublish() {
    const fixturesArr = Array.from(builderSelection.values())
    if (!fixturesArr.length || !submarkets.size) return
    setPublishing(true)
    setPublishError(null)
    try {
      const result = await publishBatch({
        fixtures: fixturesArr.map(f => ({
          id: f.id,
          home: f.home || f.homeTeamName,
          away: f.away || f.awayTeamName,
          league: f.league || f.leagueName,
          leagueCode: f.leagueCode,
          kickoff: f.kickoff,
          matchday: f.matchday,
          gameId: f.gameId,
          provider: f.provider,
        })),
        submarkets: selectedSubmarkets.map(m => m.id),
      })
      if (result.run_id) await pollRun(result.run_id)
      setBuilderSelection(new Map())
      setBuilderPublishSuccess(true)
      setTimeout(() => setBuilderPublishSuccess(false), 3000)
    } catch (err) {
      setPublishError(err.message)
    } finally {
      setPublishing(false)
    }
  }

  const hasSelection     = selected.size > 0
  const totalMarkets     = selected.size * submarkets.size
  const pendingJobCount  = scheduledJobs.filter(j => j.status === 'pending').length
  const selectedFixtures = fixtures.filter(f => selected.has(f.id))
  const selectedSubmarkets = submarketGroups.flatMap(g => g.markets).filter(m => submarkets.has(m.id))

  function toggleSubmarket(id) {
    setSubmarkets(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function toggleFixture(id) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function handleSort(field) {
    setSort(prev => prev.field === field
      ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { field, dir: 'asc' })
  }

  function clearSelection() {
    setSelected(new Set())
    setSubmarkets(new Set())
  }

  async function handlePublish(fixturesWithMarkets, totalMkts) {
    setPublishing(true)
    setPublishError(null)
    try {
      const result = await publishBatch({
        fixtures: fixturesWithMarkets.map(f => ({
          id: f.id, home: f.home, away: f.away,
          league: f.league, leagueCode: f.leagueCode,
          kickoff: f.kickoff, matchday: f.matchday,
          gameId: f.gameId, provider: f.provider,
        })),
        submarkets: selectedSubmarkets.map(m => m.id),
      })
      if (result.run_id) await pollRun(result.run_id)
      setLastActionMarkets(totalMkts)
      setView('done')
    } catch (err) {
      setPublishError(err.message)
    } finally {
      setPublishing(false)
    }
  }

  async function pollRun(runId) {
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 2000))
      const run = await fetchBatchRun(runId)
      if (['completed', 'partial', 'failed', 'stopped'].includes(run.status)) {
        if (run.status === 'failed') throw new Error(`Publish run failed`)
        return run
      }
    }
    throw new Error('Publish run timed out')
  }

  function handleSchedule(scheduleAt, fixturesWithMarkets, totalMkts) {
    setScheduledJobs(prev => [...prev, {
      id: `job_${Date.now()}`,
      fixtures: fixturesWithMarkets,
      totalMarkets: totalMkts,
      scheduledAt: scheduleAt,
      createdAt: new Date().toISOString(),
      status: 'pending',
    }])
    setLastScheduledAt(scheduleAt)
    setLastActionMarkets(totalMkts)
    setView('job-scheduled')
  }

  function handleDone() {
    clearSelection()
    setPublishError(null)
    setView('list')
  }

  return (
    <div className="app">
      <Header
        theme={theme}
        onToggleTheme={toggleTheme}
        queueCount={pendingJobCount}
        onQueueOpen={() => setQueueOpen(true)}
        user={{ name: 'Operator', initials: 'OP' }}
        onSignOut={() => {}}
        activeEnv={activeEnv}
        environments={environments}
        onSwitchEnv={handleSwitchEnv}
      />

      <TabBar tab={tab} onChange={setTab} />

      {tab === 'builder' && (
        <>
          <BuilderView
            activeEnv={activeEnv}
            submarkets={submarkets}
            onToggle={toggleSubmarket}
            builderSelectedIds={builderSelectedIds}
            onToggleBuilderFixture={handleToggleBuilderFixture}
            onSelectAllBuilderFixtures={handleSelectAllBuilderFixtures}
            onClearBuilderFixtures={handleClearBuilderFixtures}
            onBuilderPublish={handleBuilderPublish}
            publishing={publishing}
            publishError={publishError}
            publishSuccess={builderPublishSuccess}
          />
        </>
      )}

      {tab === 'fixtures' && (
        <>
          <FilterBar fixtures={fixtures} filters={filters} onChange={setFilters} count={filtered.length} />
          {error && (
            <div style={{ padding: '12px 20px', color: 'var(--s-live)' }}>
              Failed to load fixtures: {error}
            </div>
          )}
          <div className="workspace">
            <FixtureTable
              fixtures={filtered}
              selected={selected}
              onToggle={toggleFixture}
              sort={sort}
              onSort={handleSort}
              scheduledIds={scheduledFixtureIds}
              loading={loading}
            />
            <SubmarketPanel
              open={hasSelection}
              fixtureCount={selected.size}
              selected={submarkets}
              onToggle={toggleSubmarket}
              onSelectAll={() => setSubmarkets(new Set(ALL_SUBMARKET_IDS))}
              onClear={() => setSubmarkets(new Set())}
              onSetSubmarkets={ids => setSubmarkets(ids)}
            />
          </div>
          <SelectionBar
            visible={hasSelection}
            fixtureCount={selected.size}
            submarketCount={submarkets.size}
            totalMarkets={totalMarkets}
            onClear={clearSelection}
            onReview={() => setView('review')}
          />
          {view !== 'list' && (
            <ReviewOverlay
              fixtures={selectedFixtures}
              submarkets={selectedSubmarkets}
              view={view}
              lastScheduledAt={lastScheduledAt}
              lastActionMarkets={lastActionMarkets}
              publishError={publishError}
              publishing={publishing}
              onBack={() => setView('list')}
              onPublish={handlePublish}
              onSchedule={handleSchedule}
              onDone={handleDone}
              onViewQueue={() => { handleDone(); setQueueOpen(true) }}
            />
          )}
          {queueOpen && (
            <ScheduleQueue
              jobs={scheduledJobs}
              onCancel={id => setScheduledJobs(prev => prev.map(j => j.id === id ? { ...j, status: 'cancelled' } : j))}
              onEditTime={(id, t) => setScheduledJobs(prev => prev.map(j => j.id === id ? { ...j, scheduledAt: t } : j))}
              onClearCancelled={() => setScheduledJobs(prev => prev.filter(j => j.status !== 'cancelled'))}
              onClose={() => setQueueOpen(false)}
            />
          )}
        </>
      )}

      {tab === 'json' && <JsonView />}
    </div>
  )
}
