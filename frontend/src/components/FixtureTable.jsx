import { useRef, useEffect } from 'react'

function fmtKickoff(iso) {
  const d    = new Date(iso)
  const date = d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  return { date, time }
}

function StatusChip({ status }) {
  return (
    <span className={`chip chip--${status}`}>
      <span className="chip__dot" />
      {status}
    </span>
  )
}

function IndeterminateCheckbox({ checked, indeterminate, onChange }) {
  const ref = useRef(null)
  useEffect(() => { if (ref.current) ref.current.indeterminate = indeterminate }, [indeterminate])
  return (
    <input
      ref={ref}
      type="checkbox"
      className="cb"
      checked={checked}
      onChange={onChange}
      onClick={e => e.stopPropagation()}
    />
  )
}

function FixtureRow({ fixture, selected, queued, onToggle }) {
  const { date, time } = fmtKickoff(fixture.kickoff)
  return (
    <div
      className={`frow${selected ? ' frow--sel' : ''}${queued && !selected ? ' frow--queued' : ''}`}
      onClick={() => onToggle(fixture.id)}
    >
      <div className="fcell fcell--cb" onClick={e => e.stopPropagation()}>
        <input
          type="checkbox"
          className="cb"
          checked={selected}
          onChange={() => onToggle(fixture.id)}
        />
      </div>
      <div className="fcell fcell--home">{fixture.home}</div>
      <div className="fcell fcell--away">{fixture.away}</div>
      <div className="fcell fcell--league">{fixture.league}</div>
      <div className="fcell fcell--ko">
        <div className="ko-date">{date}</div>
        <div className="ko-time">{time}</div>
      </div>
      <div className="fcell">
        <StatusChip status={fixture.status} />
        {queued && <span className="chip chip--queued" style={{ marginLeft: 5 }}>Queued</span>}
      </div>
      <div className="fcell fcell--mkts">11</div>
    </div>
  )
}

export default function FixtureTable({ fixtures, selected, onToggle, sort, onSort, scheduledIds, loading }) {
  const allChecked  = fixtures.length > 0 && fixtures.every(f => selected.has(f.id))
  const someChecked = !allChecked && fixtures.some(f => selected.has(f.id))

  function handleToggleAll() {
    if (allChecked) fixtures.forEach(f => { if (selected.has(f.id))  onToggle(f.id) })
    else            fixtures.forEach(f => { if (!selected.has(f.id)) onToggle(f.id) })
  }

  function SortTh({ field, children }) {
    const active = sort.field === field
    return (
      <div
        className={`th th--sort${active ? (sort.dir === 'asc' ? ' th--asc' : ' th--desc') : ''}`}
        onClick={() => onSort(field)}
      >
        {children}
        {active && <span className="th__arrow">{sort.dir === 'asc' ? '↑' : '↓'}</span>}
      </div>
    )
  }

  if (loading) {
    return (
      <div className="ftable">
        <div className="ftable__head">
          <div className="th th--cb" />
          <div className="th">Home</div>
          <div className="th">Away</div>
          <div className="th">League</div>
          <SortTh field="kickoff">Kickoff</SortTh>
          <div className="th">Status</div>
          <div className="th">Mkts</div>
        </div>
        <div className="empty">Loading fixtures…</div>
      </div>
    )
  }

  if (fixtures.length === 0) {
    return (
      <div className="ftable">
        <div className="ftable__head">
          <div className="th th--cb" />
          <div className="th">Home</div>
          <div className="th">Away</div>
          <div className="th">League</div>
          <SortTh field="kickoff">Kickoff</SortTh>
          <div className="th">Status</div>
          <div className="th">Mkts</div>
        </div>
        <div className="empty">No fixtures match the current filters.</div>
      </div>
    )
  }

  return (
    <div className="ftable">
      <div className="ftable__head">
        <div className="th th--cb">
          <IndeterminateCheckbox
            checked={allChecked}
            indeterminate={someChecked}
            onChange={handleToggleAll}
          />
        </div>
        <div className="th">Home</div>
        <div className="th">Away</div>
        <div className="th">League</div>
        <SortTh field="kickoff">Kickoff</SortTh>
        <div className="th">Status</div>
        <div className="th">Mkts</div>
      </div>
      <div className="ftable__body">
        {fixtures.map(f => (
          <FixtureRow
            key={f.id}
            fixture={f}
            selected={selected.has(f.id)}
            queued={scheduledIds?.has(f.id)}
            onToggle={onToggle}
          />
        ))}
      </div>
    </div>
  )
}
