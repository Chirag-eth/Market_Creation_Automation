import { useState, useRef, useEffect } from 'react'
import DateTimePicker from './DateTimePicker.jsx'
import { submarketGroups } from '../data.js'

const ALL_MARKETS = submarketGroups.flatMap(g => g.markets)

function fmtKickoff(iso) {
  const d    = new Date(iso)
  const date = d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  return `${date}  ·  ${time}`
}

function fmtScheduled(dtLocal) {
  const d = new Date(dtLocal)
  return d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric', year: 'numeric' })
    + '  ·  '
    + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

function ClockIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
    </svg>
  )
}

function HeaderCheckbox({ checked, indeterminate, onChange }) {
  const ref = useRef(null)
  useEffect(() => { if (ref.current) ref.current.indeterminate = indeterminate }, [indeterminate])
  return (
    <input ref={ref} type="checkbox" className="cb"
      checked={checked} onChange={onChange} onClick={e => e.stopPropagation()} />
  )
}

// ── Inline per-fixture submarket override ─────────────────────────────
function OverrideSection({ fixtureId, effectiveIds, globalIds, onChipToggle, onReset }) {
  const isGlobal = effectiveIds.size === globalIds.size && [...effectiveIds].every(id => globalIds.has(id))
  return (
    <div className="fix-override">
      <div className="fix-override__chips">
        {ALL_MARKETS.map(m => (
          <span
            key={m.id}
            className={`fix-override__chip${effectiveIds.has(m.id) ? ' fix-override__chip--on' : ''}`}
            onClick={() => onChipToggle(fixtureId, m.id, effectiveIds)}
          >
            {m.label}
          </span>
        ))}
      </div>
      <div className="fix-override__footer">
        <span className="fix-override__note">
          {effectiveIds.size} market{effectiveIds.size !== 1 ? 's' : ''}
          {!isGlobal && ' · custom'}
        </span>
        {!isGlobal && (
          <button className="btn-ghost fix-override__reset" onClick={() => onReset(fixtureId)}>
            Reset to global
          </button>
        )}
      </div>
    </div>
  )
}

// ── ReviewOverlay ─────────────────────────────────────────────────────
export default function ReviewOverlay({
  fixtures, submarkets, view, lastScheduledAt, lastActionMarkets,
  onBack, onPublish, onSchedule, onDone, onViewQueue,
}) {
  const [reviewSel,   setReviewSel]   = useState(() => new Set(fixtures.map(f => f.id)))
  const [overrides,   setOverrides]   = useState(new Map())   // Map<fixtureId, Set<marketId>>
  const [expandedId,  setExpandedId]  = useState(null)
  const [schedModal,  setSchedModal]  = useState(false)
  const [scheduleAt,  setScheduleAt]  = useState('')

  const checkedFixtures = fixtures.filter(f => reviewSel.has(f.id))
  const globalIds       = new Set(submarkets.map(m => m.id))

  const allChecked  = checkedFixtures.length === fixtures.length
  const someChecked = checkedFixtures.length > 0 && !allChecked

  // Total respects per-fixture overrides
  const localTotal = checkedFixtures.reduce((sum, f) => {
    return sum + (overrides.has(f.id) ? overrides.get(f.id).size : submarkets.length)
  }, 0)

  function toggleFixture(id) {
    setReviewSel(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAll() {
    setReviewSel(allChecked ? new Set() : new Set(fixtures.map(f => f.id)))
  }

  function getEffectiveIds(fixtureId) {
    return overrides.get(fixtureId) ?? globalIds
  }

  function chipToggle(fixtureId, marketId, currentSet) {
    const next = new Set(currentSet)
    next.has(marketId) ? next.delete(marketId) : next.add(marketId)
    // If identical to global, drop the override
    const sameAsGlobal = next.size === globalIds.size && [...next].every(id => globalIds.has(id))
    setOverrides(prev => {
      const m = new Map(prev)
      sameAsGlobal ? m.delete(fixtureId) : m.set(fixtureId, next)
      return m
    })
  }

  function resetOverride(fixtureId) {
    setOverrides(prev => { const m = new Map(prev); m.delete(fixtureId); return m })
    setExpandedId(null)
  }

  // Build fixtures with embedded submarket arrays for parent callbacks
  function buildFixturesWithMarkets() {
    return checkedFixtures.map(f => {
      const ids  = overrides.has(f.id) ? overrides.get(f.id) : globalIds
      const mkts = ALL_MARKETS.filter(m => ids.has(m.id))
      return { ...f, customSubmarkets: mkts }
    })
  }

  // ── Success screens ───────────────────────────────────────────────
  if (view === 'done') {
    return (
      <div className="review">
        <div className="review__hdr"><div className="review__title">Market Ops</div></div>
        <div className="done">
          <div className="done__ring" style={{ color: 'var(--s-pub)' }}>✓</div>
          <div className="done__title">Published</div>
          <div className="done__sub">
            {lastActionMarkets} market{lastActionMarkets !== 1 ? 's' : ''} published successfully
          </div>
          <button className="btn-primary" style={{ marginTop: 8 }} onClick={onDone}>Back to dashboard</button>
        </div>
      </div>
    )
  }

  if (view === 'job-scheduled') {
    return (
      <div className="review">
        <div className="review__hdr"><div className="review__title">Market Ops</div></div>
        <div className="done">
          <div className="done__ring done__ring--sched"><ClockIcon /></div>
          <div className="done__title">Scheduled</div>
          <div className="done__sub">
            {lastActionMarkets} market{lastActionMarkets !== 1 ? 's' : ''} scheduled for{' '}
            <strong style={{ color: 'var(--t1)' }}>
              {lastScheduledAt ? fmtScheduled(lastScheduledAt) : '—'}
            </strong>
          </div>
          <div className="done__actions">
            <button className="btn-outline" onClick={onViewQueue}>View queue</button>
            <button className="btn-primary" onClick={onDone}>Back to dashboard</button>
          </div>
        </div>
      </div>
    )
  }

  // ── Review screen ─────────────────────────────────────────────────
  return (
    <div className="review">
      <div className="review__hdr">
        <button className="btn-back" onClick={onBack}>← Back</button>
        <div className="review__title">Publishing Summary</div>
      </div>

      <div className="review__body">
        <div className="review__inner">

          <div className="review__summary">
            <div className="review__summary-stat">
              <strong>{checkedFixtures.length}</strong>
              {checkedFixtures.length !== fixtures.length && (
                <span style={{ color: 'var(--t3)', fontWeight: 400 }}> of {fixtures.length}</span>
              )}{' '}
              fixture{checkedFixtures.length !== 1 ? 's' : ''}
            </div>
            <div className="review__summary-sep">·</div>
            <div className="review__summary-stat">
              <strong>{submarkets.length}</strong> submarket{submarkets.length !== 1 ? 's' : ''}
              {overrides.size > 0 && <span style={{ color: 'var(--t3)', fontWeight: 400 }}> (some overridden)</span>}
            </div>
            <div className="review__summary-sep">·</div>
            <div className="review__summary-stat">
              <strong>{localTotal}</strong> total market{localTotal !== 1 ? 's' : ''}
            </div>
          </div>

          {/* Fixture list with per-row checkboxes + override expand */}
          <div className="review__section">
            <div className="review__sec-hdr">
              <HeaderCheckbox checked={allChecked} indeterminate={someChecked} onChange={toggleAll} />
              <span className="review__sec-title">Fixtures</span>
              {someChecked && (
                <span className="review__sec-count">{checkedFixtures.length} of {fixtures.length}</span>
              )}
            </div>

            {fixtures.map(f => {
              const checked     = reviewSel.has(f.id)
              const hasOverride = overrides.has(f.id)
              const effectiveIds = getEffectiveIds(f.id)
              const isExpanded  = expandedId === f.id

              return (
                <div key={f.id} className="review__fixture-wrap">
                  <div
                    className={`review__fixture review__fixture--sel${checked ? ' review__fixture--checked' : ''}`}
                    onClick={() => setExpandedId(isExpanded ? null : f.id)}
                  >
                    <input type="checkbox" className="cb" checked={checked}
                      onChange={() => toggleFixture(f.id)} onClick={e => e.stopPropagation()} />
                    <div className="review__fix-match">
                      {f.home} <span className="review__fix-away">vs {f.away}</span>
                    </div>
                    <div className="review__fix-meta">{f.league}</div>
                    <div className="review__fix-meta">{fmtKickoff(f.kickoff)}</div>
                    <div className="review__fix-right">
                      {hasOverride && (
                        <span className="review__fix-custom-badge">Custom {effectiveIds.size}</span>
                      )}
                      <button
                        className={`review__fix-expand${isExpanded ? ' review__fix-expand--open' : ''}`}
                        onClick={e => e.stopPropagation()}
                        title="Expand markets"
                      >
                        ▾
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <OverrideSection
                      fixtureId={f.id}
                      effectiveIds={effectiveIds}
                      globalIds={globalIds}
                      onChipToggle={chipToggle}
                      onReset={resetOverride}
                    />
                  )}
                </div>
              )
            })}
          </div>

          <div className="review__section">
            <div className="review__sec-hdr">
              <span className="review__sec-title">Global submarkets ({submarkets.length})</span>
            </div>
            <div className="review__markets">
              {submarkets.map(m => <span key={m.id} className="mkt-tag">{m.label}</span>)}
            </div>
          </div>

        </div>
      </div>

      <div className="review__ftr">
        <div className="review__ftr-note">{localTotal} market{localTotal !== 1 ? 's' : ''} on Testnet</div>
        <button className="btn-outline" disabled={checkedFixtures.length === 0} onClick={() => setSchedModal(true)}>
          Schedule for later
        </button>
        <button className="btn-primary" disabled={checkedFixtures.length === 0}
          onClick={() => onPublish(buildFixturesWithMarkets(), localTotal)}>
          Publish now <span className="btn-primary__arrow">→</span>
        </button>
      </div>

      {schedModal && (
        <div className="sched-backdrop" onClick={() => setSchedModal(false)}>
          <div className="sched-modal" onClick={e => e.stopPropagation()}>
            <div className="sched-modal__hdr">
              <div className="sched-modal__title">Schedule publish</div>
              <div className="sched-modal__sub">
                {checkedFixtures.length} fixture{checkedFixtures.length !== 1 ? 's' : ''} · {localTotal} markets
              </div>
            </div>
            <DateTimePicker onChange={setScheduleAt} />
            <div className="sched-modal__ftr">
              <button className="btn-ghost" onClick={() => setSchedModal(false)}>Cancel</button>
              <button className="btn-primary" disabled={!scheduleAt}
                onClick={() => { setSchedModal(false); onSchedule(scheduleAt, buildFixturesWithMarkets(), localTotal) }}>
                Confirm <span className="btn-primary__arrow">→</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
