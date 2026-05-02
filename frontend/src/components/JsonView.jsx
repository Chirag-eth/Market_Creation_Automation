import { useState, useEffect, useRef } from 'react'
import { fetchJsonLeagues, searchJsonTeams, buildJsonOutputs, prepareJsonPublish, publishJsonParentMarket, createCmsFixture } from '../api.js'

const LEAF_PARAMS = {
  moneyline: { market_family: 'moneyline' },
  home_1_5:  { market_family: 'spreads', market_line: '1.5', spread_team_side: 'home' },
  away_1_5:  { market_family: 'spreads', market_line: '1.5', spread_team_side: 'away' },
  home_2_5:  { market_family: 'spreads', market_line: '2.5', spread_team_side: 'home' },
  away_2_5:  { market_family: 'spreads', market_line: '2.5', spread_team_side: 'away' },
  ou_1_5:    { market_family: 'totals', market_line: '1.5' },
  ou_2_5:    { market_family: 'totals', market_line: '2.5' },
  ou_3_5:    { market_family: 'totals', market_line: '3.5' },
  ou_4_5:    { market_family: 'totals', market_line: '4.5' },
  btts:      { market_family: 'btts' },
}

const ALL_LEAF_IDS = Object.keys(LEAF_PARAMS)

const JSON_GROUPS = [
  {
    id: 'result', label: 'Match Result',
    allLeafs: ['moneyline'],
    items: [{ id: 'moneyline', label: 'Moneyline', isLeaf: true }],
  },
  {
    id: 'handicap', label: 'Handicap',
    allLeafs: ['home_1_5', 'away_1_5', 'home_2_5', 'away_2_5'],
    items: [
      { id: 'spreads-toggle', label: 'Spreads', isLeaf: false, toggles: ['home_1_5', 'away_1_5', 'home_2_5', 'away_2_5'] },
      { id: 'home_1_5', label: 'Home 1.5', isLeaf: true },
      { id: 'away_1_5', label: 'Away 1.5', isLeaf: true },
      { id: 'home_2_5', label: 'Home 2.5', isLeaf: true },
      { id: 'away_2_5', label: 'Away 2.5', isLeaf: true },
    ],
  },
  {
    id: 'goals', label: 'Goals O/U',
    allLeafs: ['ou_1_5', 'ou_2_5', 'ou_3_5', 'ou_4_5'],
    items: [
      { id: 'totals-toggle', label: 'Totals', isLeaf: false, toggles: ['ou_1_5', 'ou_2_5', 'ou_3_5', 'ou_4_5'] },
      { id: 'ou_1_5', label: 'O/U 1.5', isLeaf: true },
      { id: 'ou_2_5', label: 'O/U 2.5', isLeaf: true },
      { id: 'ou_3_5', label: 'O/U 3.5', isLeaf: true },
      { id: 'ou_4_5', label: 'O/U 4.5', isLeaf: true },
    ],
  },
  {
    id: 'btts', label: 'Both Teams Score',
    allLeafs: ['btts'],
    items: [{ id: 'btts', label: 'BTTS', isLeaf: true }],
  },
]

function BulkToggle({ leafIds, selected, onBulk }) {
  const allIn  = leafIds.every(id => selected.has(id))
  const someIn = !allIn && leafIds.some(id => selected.has(id))
  const ref    = useRef(null)
  useEffect(() => { if (ref.current) ref.current.indeterminate = someIn }, [someIn])
  return (
    <input
      ref={ref}
      type="checkbox"
      className="cb"
      checked={allIn}
      onChange={() => onBulk(leafIds, allIn)}
      onClick={e => e.stopPropagation()}
    />
  )
}

function JsonMarketComposer({ selected, onToggle, onBulk }) {
  return (
    <div className="mcomposer">
      <div className="mcomposer__hdr">
        <BulkToggle leafIds={ALL_LEAF_IDS} selected={selected} onBulk={onBulk} />
        <span className="mcomposer__title">Market Family</span>
        {selected.size > 0 && (
          <span className="mcomposer__count">{selected.size} selected</span>
        )}
      </div>
      <div className="mcomposer__body">
        {JSON_GROUPS.map(group => (
          <div key={group.id} className="mcomposer__group">
            <div className="mcomposer__group-hdr">
              <BulkToggle leafIds={group.allLeafs} selected={selected} onBulk={onBulk} />
              <span className="mcomposer__group-label">{group.label}</span>
            </div>
            {group.items.map(item =>
              item.isLeaf ? (
                <label key={item.id} className="mcomposer__item">
                  <input
                    type="checkbox"
                    className="cb"
                    checked={selected.has(item.id)}
                    onChange={() => onToggle(item.id)}
                  />
                  <span className="mcomposer__item-label">{item.label}</span>
                </label>
              ) : (
                <label key={item.id} className="mcomposer__item">
                  <BulkToggle leafIds={item.toggles} selected={selected} onBulk={onBulk} />
                  <span className="mcomposer__item-label">{item.label}</span>
                </label>
              )
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// Team name autocomplete backed by /api/json/teams
function TeamAutocomplete({ placeholder, leagueId, value, onChange, onPick }) {
  const [options, setOptions] = useState([])
  const [open,    setOpen]    = useState(false)
  const [busy,    setBusy]    = useState(false)
  const debRef   = useRef(null)
  const wrapRef  = useRef(null)

  useEffect(() => {
    const close = e => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  // Re-search when leagueId changes and we already have a query
  useEffect(() => {
    if (value.trim().length >= 2) triggerSearch(value.trim())
  }, [leagueId]) // eslint-disable-line react-hooks/exhaustive-deps

  function triggerSearch(q) {
    clearTimeout(debRef.current)
    debRef.current = setTimeout(async () => {
      setBusy(true)
      try {
        const data = await searchJsonTeams(q, leagueId || '')
        setOptions(data.teams || [])
        setOpen((data.teams || []).length > 0)
      } catch { setOptions([]) }
      finally { setBusy(false) }
    }, 280)
  }

  function handleInput(e) {
    const text = e.target.value
    onChange(text)
    onPick(null)
    if (text.trim().length < 2) { clearTimeout(debRef.current); setOptions([]); setOpen(false); return }
    triggerSearch(text.trim())
  }

  function pick(t) {
    onChange(t.name)
    onPick(t)
    setOptions([])
    setOpen(false)
  }

  function clear() {
    onChange('')
    onPick(null)
    setOptions([])
    setOpen(false)
    clearTimeout(debRef.current)
  }

  return (
    <div className="team-ac" ref={wrapRef}>
      <div className="team-ac__row">
        <input
          className="json-fixture-bar__input team-ac__input"
          type="text"
          placeholder={placeholder}
          value={value}
          onChange={handleInput}
          onFocus={() => options.length && setOpen(true)}
          autoComplete="off"
        />
        {value && (
          <button className="team-ac__x" type="button" tabIndex={-1}
            onMouseDown={e => { e.preventDefault(); clear() }}>×</button>
        )}
        {busy && <span className="team-ac__dot" />}
      </div>
      {open && options.length > 0 && (
        <ul className="team-ac__menu">
          {options.map(t => (
            <li key={t.team_id}>
              <button className="team-ac__opt" type="button"
                onMouseDown={e => { e.preventDefault(); pick(t) }}>
                <span className="team-ac__opt-name">{t.name}</span>
                {t.alternate_name && t.alternate_name !== t.name && (
                  <span className="team-ac__opt-alt"> · {t.alternate_name}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function isValidJson(text) {
  if (!text.trim()) return true
  try { JSON.parse(text); return true } catch { return false }
}

function JsonPanel({ title, value, onChange, readOnly = false }) {
  const [copied, setCopied] = useState(false)
  const invalid = !readOnly && value.trim() && !isValidJson(value)

  function copy() {
    navigator.clipboard.writeText(value || '').then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="json-panel">
      <div className="json-panel__hdr">
        <span className="json-panel__title">{title}</span>
        <div className="json-panel__hdr-right">
          {invalid && <span className="json-panel__invalid">Invalid JSON</span>}
          <button className="btn-ghost json-panel__copy" onClick={copy} disabled={!value}>
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>
      <textarea
        className={`json-panel__editor${invalid ? ' json-panel__editor--invalid' : ''}${readOnly ? ' json-panel__editor--readonly' : ''}`}
        value={value}
        onChange={readOnly ? undefined : e => onChange(e.target.value)}
        readOnly={readOnly}
        spellCheck={false}
        placeholder={readOnly ? 'Fills in once fixture details are entered…' : ''}
      />
    </div>
  )
}

const CREATE_PARENT_MARKETS = [
  { id: 'moneyline',   label: 'Moneyline' },
  { id: 'btts',        label: 'BTTS' },
  { id: 'totals_1.5',  label: 'Totals 1.5' },
  { id: 'totals_2.5',  label: 'Totals 2.5' },
  { id: 'totals_3.5',  label: 'Totals 3.5' },
  { id: 'totals_4.5',  label: 'Totals 4.5' },
  { id: 'spreads_1.5', label: 'Spreads 1.5' },
  { id: 'spreads_2.5', label: 'Spreads 2.5' },
]

const CREATE_SOURCES = [
  { id: 'sports_data', label: 'SportsData' },
  { id: 'lsports',     label: 'LSports' },
]

function CreateFixturePanel() {
  const [gameId,     setGameId]     = useState('')
  const [source,     setSource]     = useState('sports_data')
  const [cname,      setCname]      = useState('')
  const [appendix,   setAppendix]   = useState('')
  const [markets,    setMarkets]    = useState(new Set(['moneyline', 'btts', 'totals_1.5', 'totals_2.5']))
  const [creating,   setCreating]   = useState(false)
  const [result,     setResult]     = useState(null)
  const [error,      setError]      = useState(null)

  function toggleMarket(id) {
    setMarkets(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  async function handleCreate() {
    if (!gameId.trim() || !cname.trim() || !markets.size) return
    setCreating(true); setResult(null); setError(null)
    try {
      const data = await createCmsFixture({
        gameId: gameId.trim(),
        source,
        parentMarkets: [...markets],
        cname: cname.trim(),
        appendix,
      })
      setResult(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setCreating(false)
    }
  }

  const canCreate = gameId.trim() && cname.trim() && markets.size > 0 && !creating

  return (
    <div className="create-fixture">
      <div className="create-fixture__card">
        <div className="create-fixture__hdr">Create Fixture via Game ID</div>

        <div className="create-fixture__fields">
          <div className="create-fixture__row">
            <div className="create-fixture__field">
              <label className="create-fixture__label">Game ID</label>
              <input
                className="json-fixture-bar__input"
                type="text"
                placeholder="e.g. 91368"
                value={gameId}
                onChange={e => { setGameId(e.target.value); setResult(null); setError(null) }}
              />
            </div>
            <div className="create-fixture__field">
              <label className="create-fixture__label">Source</label>
              <select
                className="json-fixture-bar__input json-fixture-bar__select"
                value={source}
                onChange={e => setSource(e.target.value)}
              >
                {CREATE_SOURCES.map(s => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="create-fixture__field">
            <label className="create-fixture__label">cname</label>
            <input
              className="json-fixture-bar__input"
              type="text"
              placeholder="e.g. team-a-vs-team-b"
              value={cname}
              onChange={e => { setCname(e.target.value); setResult(null); setError(null) }}
            />
          </div>

          <div className="create-fixture__field">
            <label className="create-fixture__label">Appendix <span className="create-fixture__opt">(optional)</span></label>
            <input
              className="json-fixture-bar__input"
              type="text"
              placeholder="leave blank if not needed"
              value={appendix}
              onChange={e => setAppendix(e.target.value)}
            />
          </div>
        </div>

        <div className="create-fixture__markets">
          <div className="create-fixture__label">Parent Markets</div>
          <div className="create-fixture__chips">
            {CREATE_PARENT_MARKETS.map(m => (
              <button
                key={m.id}
                type="button"
                className={`create-fixture__chip${markets.has(m.id) ? ' create-fixture__chip--on' : ''}`}
                onClick={() => toggleMarket(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div className="create-fixture__footer">
          {result && !error && (
            <div className="builder__publish-ok">
              Fixture created{result?.data?.fixture_id ? ` · ID: ${result.data.fixture_id}` : ''}
            </div>
          )}
          {error && <div className="builder__publish-err">{error}</div>}
          <button className="btn-primary" disabled={!canCreate} onClick={handleCreate}>
            {creating ? 'Creating…' : 'Create Fixture'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function JsonView() {
  const [jsonSubTab, setJsonSubTab] = useState('builder')

  // League list from DB
  const [leagues,      setLeagues]      = useState([])
  const [leagueId,     setLeagueId]     = useState('')

  // Team inputs — text value + DB-resolved object
  const [homeName,    setHomeName]    = useState('')
  const [homePick,    setHomePick]    = useState(null)   // { team_id, name, alternate_name, logo_url }
  const [awayName,    setAwayName]    = useState('')
  const [awayPick,    setAwayPick]    = useState(null)

  const [kickoff,     setKickoff]     = useState('')

  // Stable type_reference_id — reset when fixture identity changes
  const typeRefRef       = useRef(null)
  const prevFixtureKey   = useRef('')

  const fixtureParsedRef = useRef(null)  // raw fixture payload object from last build

  const [selected,       setSelected]       = useState(new Set())
  const [fixtureJson,    setFixtureJson]    = useState('')
  const [parentJson,     setParentJson]     = useState('')
  const [parentPayloads, setParentPayloads] = useState([])
  const [teamsResolved,  setTeamsResolved]  = useState(true)

  const [generating,    setGenerating]    = useState(false)
  const [genError,      setGenError]      = useState(null)

  const [publishing,    setPublishing]    = useState(false)
  const [publishResult, setPublishResult] = useState(null)
  const [publishError,  setPublishError]  = useState(null)

  const debounceRef = useRef(null)

  // Fetch leagues from DB on mount
  useEffect(() => {
    fetchJsonLeagues()
      .then(data => setLeagues(Array.isArray(data.leagues) ? data.leagues : []))
      .catch(() => {})
  }, [])

  // Generate JSON whenever inputs or market selection changes
  useEffect(() => {
    const leafIds = Array.from(selected).filter(id => LEAF_PARAMS[id])

    if (!homeName.trim() || !awayName.trim() || !kickoff.trim()) {
      setFixtureJson('')
      setParentJson('')
      setParentPayloads([])
      setTeamsResolved(true)
      setGenError(null)
      return
    }

    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      // Reset type_reference_id when fixture identity changes
      const fixtureKey = `${homeName.trim()}|${awayName.trim()}|${kickoff.trim()}`
      if (fixtureKey !== prevFixtureKey.current) {
        typeRefRef.current   = null
        prevFixtureKey.current = fixtureKey
      }
      if (!typeRefRef.current) typeRefRef.current = crypto.randomUUID()

      const leagueRow  = leagues.find(l => l.league_id === leagueId) || null
      const leagueName = leagueRow?.name || ''
      const kickoffIso = kickoff.includes('Z') ? kickoff : kickoff + ':00Z'
      const leaves     = leafIds.map(id => ({ id, ...LEAF_PARAMS[id] }))

      setGenerating(true)
      setGenError(null)
      try {
        const data = await buildJsonOutputs({
          fixtureName:     `${homeName.trim()} vs ${awayName.trim()}`,
          homeTeam:        homeName.trim(),
          homeTeamId:      homePick?.team_id      || '',
          homeTeamAlt:     homePick?.alternate_name || homeName.trim(),
          awayTeam:        awayName.trim(),
          awayTeamId:      awayPick?.team_id      || '',
          awayTeamAlt:     awayPick?.alternate_name || awayName.trim(),
          leagueName,
          leagueId:        leagueId || '',
          kickoffIso,
          typeReferenceId: typeRefRef.current,
          leaves,
        })
        fixtureParsedRef.current = data.fixture_payload || null
        setTeamsResolved(data.teams_resolved !== false)
        setFixtureJson(JSON.stringify(data.fixture_payload, null, 2))
        setParentPayloads(data.parent_payloads || [])
        const payloads = (data.parent_payloads || []).map(p => p.payload)
        setParentJson(
          payloads.length === 0 ? '' :
          JSON.stringify(payloads.length === 1 ? payloads[0] : payloads, null, 2)
        )
      } catch (err) {
        setGenError(err.message)
        setFixtureJson('')
        setParentJson('')
        setParentPayloads([])
      } finally {
        setGenerating(false)
      }
    }, 400)
    return () => clearTimeout(debounceRef.current)
  }, [homeName, homePick, awayName, awayPick, leagueId, kickoff, selected, leagues])

  function handleToggle(id) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
    setPublishResult(null); setPublishError(null)
  }

  function handleBulk(ids, allIn) {
    setSelected(prev => { const n = new Set(prev); ids.forEach(id => allIn ? n.delete(id) : n.add(id)); return n })
    setPublishResult(null); setPublishError(null)
  }

  async function handlePublish() {
    if (!parentPayloads.length) return
    setPublishing(true); setPublishResult(null); setPublishError(null)
    try {
      const fixturePayload = fixtureParsedRef.current
      if (!fixturePayload) throw new Error('No fixture payload — fill in fixture details first')

      const leagueRow  = leagues.find(l => l.league_id === leagueId) || null
      const leagueSlug = leagueRow?.name?.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || ''

      const { type_reference_id: realTypeRefId } = await prepareJsonPublish(fixturePayload, leagueSlug, homeName.trim(), awayName.trim())

      const results = await Promise.allSettled(
        parentPayloads.map(({ payload }) => {
          const resolved = {
            ...payload,
            parent_market: { ...payload.parent_market, type_reference_id: realTypeRefId },
          }
          return publishJsonParentMarket(resolved)
        })
      )
      const succeeded = results.filter(r => r.status === 'fulfilled').length
      const failed    = results.filter(r => r.status === 'rejected')
      setPublishResult({ succeeded, total: results.length })
      if (failed.length) setPublishError(`${failed.length} failed: ${failed[0]?.reason?.message || 'Unknown error'}`)
    } catch (err) {
      setPublishError(err.message)
    } finally {
      setPublishing(false)
    }
  }

  const canPublish = parentPayloads.length > 0 && !publishing && teamsResolved
  const selectedLeague = leagues.find(l => l.league_id === leagueId) || null

  return (
    <div className="json-view">
      <div className="json-subtabs">
        <button
          className={`json-subtab${jsonSubTab === 'builder' ? ' json-subtab--active' : ''}`}
          onClick={() => setJsonSubTab('builder')}
        >Builder</button>
        <button
          className={`json-subtab${jsonSubTab === 'create' ? ' json-subtab--active' : ''}`}
          onClick={() => setJsonSubTab('create')}
        >Create via ID</button>
      </div>

      {jsonSubTab === 'create' && <CreateFixturePanel />}
      {jsonSubTab === 'builder' && <div className="builder__main">

        {/* ── Left: market selector + publish ── */}
        <div className="builder__left">
          <JsonMarketComposer selected={selected} onToggle={handleToggle} onBulk={handleBulk} />
          <div className="builder__publish">
            <div className="builder__publish-divider" />
            <div className="builder__publish-summary">
              {selected.size > 0
                ? <><strong>{selected.size}</strong> market{selected.size !== 1 ? 's' : ''} selected</>
                : <span className="builder__publish-hint">Select markets on the left</span>
              }
            </div>
            {!teamsResolved && parentPayloads.length > 0 && (
              <div className="builder__publish-warn">Team IDs not found — select teams from autocomplete</div>
            )}
            {publishResult && !publishError && (
              <div className="builder__publish-ok">Published {publishResult.succeeded} / {publishResult.total}</div>
            )}
            {publishError && <div className="builder__publish-err">{publishError}</div>}
            <button className="btn-primary builder__publish-btn" disabled={!canPublish} onClick={handlePublish}>
              {publishing ? 'Publishing…' : 'Publish'}
            </button>
          </div>
        </div>

        {/* ── Right: fixture form + JSON panels ── */}
        <div className="builder__right json-right">
          <div className="json-fixture-bar json-fixture-bar--grid">

            {/* Home team */}
            <TeamAutocomplete
              placeholder="Home team"
              leagueId={leagueId}
              value={homeName}
              onChange={setHomeName}
              onPick={setHomePick}
            />

            {/* Away team */}
            <TeamAutocomplete
              placeholder="Away team"
              leagueId={leagueId}
              value={awayName}
              onChange={setAwayName}
              onPick={setAwayPick}
            />

            {/* League from DB */}
            <select
              className="json-fixture-bar__input json-fixture-bar__select"
              value={leagueId}
              onChange={e => { setLeagueId(e.target.value); setHomePick(null); setAwayPick(null) }}
            >
              <option value="">Select league…</option>
              {leagues.map(l => (
                <option key={l.league_id} value={l.league_id}>{l.name}</option>
              ))}
            </select>

            {/* Kickoff */}
            <input
              className="json-fixture-bar__input json-fixture-bar__input--datetime"
              type="datetime-local"
              value={kickoff}
              onChange={e => setKickoff(e.target.value)}
            />

            {/* League meta when selected */}
            {selectedLeague && (
              <div className="json-league-meta">
                <span className="json-league-meta__id" title={selectedLeague.league_id}>
                  ID: {selectedLeague.league_id}
                </span>
                {selectedLeague.theme_color && (
                  <span className="json-league-meta__color" style={{ background: selectedLeague.theme_color }} />
                )}
              </div>
            )}

            {generating && <span className="json-fixture-bar__hint">Generating…</span>}
            {genError   && <span className="json-fixture-bar__err">{genError}</span>}
          </div>

          <div className="json-panels">
            <JsonPanel title="Fixture JSON" value={fixtureJson} onChange={setFixtureJson} readOnly />
            <JsonPanel
              title={generating ? 'Parent Market JSON (generating…)' : 'Parent Market JSON'}
              value={parentJson}
              onChange={setParentJson}
              readOnly
            />
          </div>
        </div>

      </div>}

    </div>
  )
}
