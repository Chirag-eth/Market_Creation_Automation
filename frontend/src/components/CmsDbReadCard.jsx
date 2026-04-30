import { useState } from 'react'

export default function CmsDbReadCard() {
  const [query,   setQuery]   = useState('')
  const [loading, setLoading] = useState(false)
  const [result,  setResult]  = useState(null)
  const [error,   setError]   = useState(null)

  async function handleRead() {
    if (!query.trim()) return
    setLoading(true)
    setResult(null)
    setError(null)
    try {
      const res = await fetch('/api/db/verify/fixture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_name: query.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setResult(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="cms-db-card">
      <div className="cms-db-card__hdr">
        <span className="cms-db-card__title">CMS / DB Read</span>
        <span className="cms-db-card__sub">Look up a fixture or market in the database</span>
      </div>
      <div className="cms-db-card__row">
        <input
          className="cms-db-card__input"
          type="text"
          placeholder="Event name or fixture ID…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleRead()}
        />
        <button
          className="btn-primary cms-db-card__btn"
          onClick={handleRead}
          disabled={loading || !query.trim()}
        >
          {loading ? 'Reading…' : 'Read from DB'}
        </button>
      </div>
      {error && (
        <div className="cms-db-card__result cms-db-card__result--err">{error}</div>
      )}
      {result && (
        <div className="cms-db-card__result">
          <pre className="cms-db-card__pre">{JSON.stringify(result, null, 2)}</pre>
        </div>
      )}
    </div>
  )
}
