import { useState } from 'react'
import { publishJsonFixture, publishJsonParentMarket } from '../api.js'

const MARKET_FAMILIES = [
  { id: 'moneyline', label: 'Moneyline' },
  { id: 'spreads',   label: 'Spreads' },
  { id: 'totals',    label: 'Totals' },
  { id: 'btts',      label: 'Both Teams Score (BTTS)' },
]

const SPREAD_LINES = ['1.5', '2.5']
const TOTAL_LINES  = ['1.5', '2.5', '3.5', '4.5']

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
      />
    </div>
  )
}

function StatusPill({ label, existed }) {
  return (
    <span className={`json-status-pill${existed ? ' json-status-pill--existed' : ' json-status-pill--created'}`}>
      {label}: {existed ? 'already existed' : 'created'}
    </span>
  )
}

export default function JsonView() {
  // ── Step 1: fixture lookup + publish ──────────────────────────────────────
  const [fixtureName,       setFixtureName]       = useState('')
  const [fixturePublishing, setFixturePublishing] = useState(false)
  const [fixtureResult,     setFixtureResult]     = useState(null)   // { fixture_id, type_reference_id, fixture_existed, type_ref_existed, fixture_payload }
  const [fixtureError,      setFixtureError]      = useState(null)
  const [fixtureJson,       setFixtureJson]       = useState('')     // editable fixture JSON preview

  // ── Step 2: parent market generation + publish ────────────────────────────
  const [typeRefId,         setTypeRefId]         = useState('')
  const [marketFamily,      setMarketFamily]      = useState('moneyline')
  const [marketLine,        setMarketLine]        = useState('1.5')
  const [spreadSide,        setSpreadSide]        = useState('home')
  const [generating,        setGenerating]        = useState(false)
  const [generated,         setGenerated]         = useState('')
  const [genError,          setGenError]          = useState(null)
  const [publishing,        setPublishing]        = useState(false)
  const [publishResult,     setPublishResult]     = useState(null)
  const [publishError,      setPublishError]      = useState(null)

  async function handlePublishFixture() {
    if (!fixtureName.trim()) return
    setFixturePublishing(true)
    setFixtureError(null)
    setFixtureResult(null)
    setFixtureJson('')
    setTypeRefId('')
    setGenerated('')
    setGenError(null)
    setPublishResult(null)
    setPublishError(null)
    try {
      const data = await publishJsonFixture(fixtureName.trim())
      setFixtureResult(data)
      setFixtureJson(JSON.stringify(data.fixture_payload, null, 2))
      setTypeRefId(data.type_reference_id || '')
    } catch (err) {
      setFixtureError(err.message)
    } finally {
      setFixturePublishing(false)
    }
  }

  async function handleGenerate() {
    if (!typeRefId.trim()) return
    setGenerating(true)
    setGenError(null)
    setGenerated('')
    setPublishResult(null)
    setPublishError(null)
    try {
      const res = await fetch('/api/json/generate-parent-market', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fixture_name:      fixtureName.trim(),
          type_reference_id: typeRefId.trim(),
          market_family:     marketFamily,
          market_line:       marketLine,
          spread_team_side:  spreadSide,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setGenerated(JSON.stringify(data.payload, null, 2))
    } catch (err) {
      setGenError(err.message)
    } finally {
      setGenerating(false)
    }
  }

  async function handlePublishParentMarket() {
    if (!generated.trim() || !isValidJson(generated)) return
    setPublishing(true)
    setPublishError(null)
    setPublishResult(null)
    try {
      const payload = JSON.parse(generated)
      const data = await publishJsonParentMarket(payload)
      setPublishResult(data)
    } catch (err) {
      setPublishError(err.message)
    } finally {
      setPublishing(false)
    }
  }

  const showLine = marketFamily === 'spreads' || marketFamily === 'totals'
  const showSide = marketFamily === 'spreads'
  const lineOpts = marketFamily === 'spreads' ? SPREAD_LINES : TOTAL_LINES
  const canPublishParent = generated.trim() && isValidJson(generated) && !publishing

  return (
    <div className="json-view">

      {/* ── Step 1 ── */}
      <div className="json-event-setup">
        <div className="json-event-setup__hdr">
          <span className="json-event-setup__title">Step 1 — Publish Fixture &amp; Type Reference</span>
        </div>
        <div className="json-event-setup__fields">
          <label className="json-field">
            <span className="json-field__label">Fixture Name</span>
            <input
              className="json-field__input"
              type="text"
              placeholder="e.g. Arsenal vs Chelsea"
              value={fixtureName}
              onChange={e => setFixtureName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handlePublishFixture()}
            />
          </label>
        </div>
        <div className="json-event-setup__actions">
          <button
            className="btn-primary"
            onClick={handlePublishFixture}
            disabled={fixturePublishing || !fixtureName.trim()}
          >
            {fixturePublishing ? 'Publishing…' : 'Publish Fixture'}
          </button>
        </div>
        {fixtureError && <div className="json-error">{fixtureError}</div>}
        {fixtureResult && (
          <div className="json-publish-status">
            <StatusPill label="Fixture"       existed={fixtureResult.fixture_existed} />
            <StatusPill label="Type Reference" existed={fixtureResult.type_ref_existed} />
            <span className="json-status-id">Type Ref ID: {fixtureResult.type_reference_id}</span>
          </div>
        )}
      </div>

      {fixtureJson && (
        <div className="json-panels">
          <JsonPanel title="Fixture JSON" value={fixtureJson} onChange={setFixtureJson} readOnly />
        </div>
      )}

      {/* ── Step 2 ── */}
      <div className="json-event-setup json-event-setup--step2">
        <div className="json-event-setup__hdr">
          <span className="json-event-setup__title">Step 2 — Generate &amp; Publish Parent Market</span>
        </div>
        <div className="json-event-setup__fields">
          <label className="json-field">
            <span className="json-field__label">Type Reference ID</span>
            <input
              className="json-field__input"
              type="text"
              placeholder="UUID (auto-filled after Step 1)"
              value={typeRefId}
              onChange={e => setTypeRefId(e.target.value)}
            />
          </label>
          <label className="json-field">
            <span className="json-field__label">Market Family</span>
            <select
              className="json-field__input json-field__select"
              value={marketFamily}
              onChange={e => { setMarketFamily(e.target.value); setGenerated(''); setGenError(null); setPublishResult(null); setPublishError(null) }}
            >
              {MARKET_FAMILIES.map(f => (
                <option key={f.id} value={f.id}>{f.label}</option>
              ))}
            </select>
          </label>
          {showLine && (
            <label className="json-field">
              <span className="json-field__label">Market Line</span>
              <select
                className="json-field__input json-field__select"
                value={marketLine}
                onChange={e => { setMarketLine(e.target.value); setGenerated(''); setGenError(null); setPublishResult(null); setPublishError(null) }}
              >
                {lineOpts.map(l => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            </label>
          )}
          {showSide && (
            <label className="json-field">
              <span className="json-field__label">Spread Team</span>
              <select
                className="json-field__input json-field__select"
                value={spreadSide}
                onChange={e => { setSpreadSide(e.target.value); setGenerated(''); setGenError(null); setPublishResult(null); setPublishError(null) }}
              >
                <option value="home">Home Team</option>
                <option value="away">Away Team</option>
              </select>
            </label>
          )}
        </div>
        <div className="json-event-setup__actions">
          <button
            className="btn-primary"
            onClick={handleGenerate}
            disabled={generating || !typeRefId.trim() || !fixtureName.trim()}
          >
            {generating ? 'Generating…' : 'Generate'}
          </button>
          {generated && (
            <button
              className="btn-primary btn-publish"
              onClick={handlePublishParentMarket}
              disabled={!canPublishParent}
            >
              {publishing ? 'Publishing…' : 'Publish'}
            </button>
          )}
        </div>
        {genError    && <div className="json-error">{genError}</div>}
        {publishError && <div className="json-error">{publishError}</div>}
        {publishResult && (
          <div className="json-publish-status">
            <span className="json-status-pill json-status-pill--created">Parent market published</span>
          </div>
        )}
      </div>

      {generated && (
        <div className="json-panels">
          <JsonPanel title="Parent Market JSON" value={generated} onChange={setGenerated} />
        </div>
      )}
    </div>
  )
}
