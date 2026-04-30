import { useState, useEffect, useRef } from 'react'
import { publishJsonFixture, publishJsonParentMarket, generateParentMarket, fetchJsonLeagues } from '../api.js'

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
        placeholder={readOnly ? 'Auto-generated after fixture loads…' : ''}
      />
    </div>
  )
}

export default function JsonView() {
  const [leagues,        setLeagues]        = useState([])
  const [leagueId,       setLeagueId]       = useState('')

  const [fixtureName,    setFixtureName]    = useState('')
  const [fixtureLoading, setFixtureLoading] = useState(false)
  const [fixtureError,   setFixtureError]   = useState(null)
  const [fixtureJson,    setFixtureJson]    = useState('')
  const [typeRefId,      setTypeRefId]      = useState('')

  const [selected,       setSelected]       = useState(new Set())

  const [parentPayloads, setParentPayloads] = useState([])
  const [parentJson,     setParentJson]     = useState('')
  const [parentLoading,  setParentLoading]  = useState(false)
  const [parentError,    setParentError]    = useState(null)

  const [publishing,     setPublishing]     = useState(false)
  const [publishResult,  setPublishResult]  = useState(null)
  const [publishError,   setPublishError]   = useState(null)

  const debounceRef  = useRef(null)
  const parentGenRef = useRef(0)

  // Fetch leagues from DB on mount
  useEffect(() => {
    fetchJsonLeagues()
      .then(data => setLeagues(Array.isArray(data.leagues) ? data.leagues : []))
      .catch(() => {})
  }, [])

  // Debounced fixture fetch on name or league change
  useEffect(() => {
    const name = fixtureName.trim()
    if (!name) {
      setFixtureJson('')
      setTypeRefId('')
      setFixtureError(null)
      setParentJson('')
      setParentPayloads([])
      setParentError(null)
      setPublishResult(null)
      setPublishError(null)
      return
    }
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setFixtureLoading(true)
      setFixtureError(null)
      try {
        const data = await publishJsonFixture(name, leagueId)
        setFixtureJson(JSON.stringify(data.fixture_payload, null, 2))
        setTypeRefId(data.type_reference_id || '')
      } catch (err) {
        setFixtureError(err.message)
        setFixtureJson('')
        setTypeRefId('')
      } finally {
        setFixtureLoading(false)
      }
    }, 600)
    return () => clearTimeout(debounceRef.current)
  }, [fixtureName, leagueId])

  // Auto-generate parent markets when typeRefId or selection changes
  useEffect(() => {
    const leafIds = Array.from(selected).filter(id => LEAF_PARAMS[id])
    if (!typeRefId || !fixtureName.trim() || !leafIds.length) {
      setParentJson('')
      setParentPayloads([])
      setParentError(null)
      return
    }
    const gen = ++parentGenRef.current
    setParentLoading(true)
    setParentError(null)

    Promise.all(
      leafIds.map(id =>
        generateParentMarket({ fixture_name: fixtureName.trim(), type_reference_id: typeRefId, ...LEAF_PARAMS[id] })
          .then(data => ({ id, payload: data.payload }))
      )
    ).then(results => {
      if (parentGenRef.current !== gen) return
      setParentPayloads(results)
      const payloads = results.map(r => r.payload)
      setParentJson(JSON.stringify(payloads.length === 1 ? payloads[0] : payloads, null, 2))
    }).catch(err => {
      if (parentGenRef.current !== gen) return
      setParentError(err.message)
      setParentJson('')
      setParentPayloads([])
    }).finally(() => {
      if (parentGenRef.current === gen) setParentLoading(false)
    })
  }, [typeRefId, selected, fixtureName])

  function handleToggle(id) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
    setPublishResult(null)
    setPublishError(null)
  }

  function handleBulk(ids, allIn) {
    setSelected(prev => { const n = new Set(prev); ids.forEach(id => allIn ? n.delete(id) : n.add(id)); return n })
    setPublishResult(null)
    setPublishError(null)
  }

  async function handlePublish() {
    if (!parentPayloads.length) return
    setPublishing(true)
    setPublishResult(null)
    setPublishError(null)
    const results = await Promise.allSettled(
      parentPayloads.map(({ payload }) => publishJsonParentMarket(payload))
    )
    const succeeded = results.filter(r => r.status === 'fulfilled').length
    const failed    = results.filter(r => r.status === 'rejected')
    setPublishResult({ succeeded, total: results.length })
    if (failed.length) {
      setPublishError(`${failed.length} failed: ${failed[0]?.reason?.message || 'Unknown error'}`)
    }
    setPublishing(false)
  }

  const canPublish = parentPayloads.length > 0 && !publishing

  return (
    <div className="json-view">
      <div className="builder__main">

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
            {publishResult && !publishError && (
              <div className="builder__publish-ok">
                Published {publishResult.succeeded} / {publishResult.total}
              </div>
            )}
            {publishError && (
              <div className="builder__publish-err">{publishError}</div>
            )}
            <button
              className="btn-primary builder__publish-btn"
              disabled={!canPublish}
              onClick={handlePublish}
            >
              {publishing ? 'Publishing…' : 'Publish'}
            </button>
          </div>
        </div>

        {/* ── Right: fixture bar + JSON panels ── */}
        <div className="builder__right json-right">
          <div className="json-fixture-bar">
            <span className="json-fixture-bar__label">Fixture Name</span>
            <input
              className="json-fixture-bar__input"
              type="text"
              placeholder="e.g. Arsenal vs Chelsea"
              value={fixtureName}
              onChange={e => setFixtureName(e.target.value)}
            />
            <select
              className="json-fixture-bar__select"
              value={leagueId}
              onChange={e => setLeagueId(e.target.value)}
            >
              <option value="">All leagues</option>
              {leagues.map(l => (
                <option key={l.league_id} value={l.league_id}>{l.name}</option>
              ))}
            </select>
            {fixtureLoading && <span className="json-fixture-bar__hint">Fetching…</span>}
            {fixtureError   && <span className="json-fixture-bar__err">{fixtureError}</span>}
          </div>

          <div className="json-panels">
            <JsonPanel
              title="Fixture JSON"
              value={fixtureJson}
              onChange={setFixtureJson}
            />
            <JsonPanel
              title={parentLoading ? 'Parent Market JSON (generating…)' : 'Parent Market JSON'}
              value={parentJson}
              onChange={setParentJson}
              readOnly
            />
          </div>

          {parentError && <div className="json-panels-err">{parentError}</div>}
        </div>

      </div>
    </div>
  )
}
