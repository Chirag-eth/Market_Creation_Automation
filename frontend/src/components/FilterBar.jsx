function fmtDate(iso) {
  const d = new Date(iso + 'T00:00:00Z')
  return d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export default function FilterBar({ fixtures = [], filters, onChange, count }) {
  const leagues   = [...new Set(fixtures.map(f => f.league))].sort()
  const dates     = [...new Set(fixtures.map(f => f.kickoff.slice(0, 10)))].sort()
  const matchdays = [...new Set(fixtures.map(f => f.matchday).filter(Boolean))].sort((a, b) => a - b)

  return (
    <div className="fbar">
      <span className="fbar__label">Filter</span>

      <select
        className="fbar__sel"
        value={filters.league}
        onChange={e => onChange({ ...filters, league: e.target.value })}
      >
        <option value="">All Leagues</option>
        {leagues.map(l => <option key={l} value={l}>{l}</option>)}
      </select>

      <select
        className="fbar__sel"
        value={filters.date}
        onChange={e => onChange({ ...filters, date: e.target.value })}
      >
        <option value="">All Dates</option>
        {dates.map(d => <option key={d} value={d}>{fmtDate(d)}</option>)}
      </select>

      <select
        className="fbar__sel"
        value={filters.matchday}
        onChange={e => onChange({ ...filters, matchday: e.target.value })}
      >
        <option value="">All Matchdays</option>
        {matchdays.map(m => <option key={m} value={String(m)}>MD {m}</option>)}
      </select>

      <div className="fbar__div" />

      <input
        type="text"
        className="fbar__search"
        placeholder="Search teams…"
        value={filters.search}
        onChange={e => onChange({ ...filters, search: e.target.value })}
      />

      {filters.search && (
        <button className="fbar__clear-search" onClick={() => onChange({ ...filters, search: '' })}>
          ✕
        </button>
      )}

      <span className="fbar__count">
        {count} fixture{count !== 1 ? 's' : ''}
      </span>
    </div>
  )
}
