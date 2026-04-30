import { useState, useEffect, useRef } from 'react'
import { fetchLeagues, fetchFixtures, fetchScheduleStatus } from '../api.js'

const POLL_INTERVAL_MS = 60_000 // 1 minute — checks versions, fetches only if changed

function normalizeFixture(f, league) {
  return {
    id:         f.providerFixtureId || f.fixture_id || `${league.code}-${f.eventName}`,
    home:       f.homeTeamName  || '',
    away:       f.awayTeamName  || '',
    league:     league.label    || league.code,
    leagueCode: league.code,
    kickoff:    f.kickoffIso    || `${f.fixtureDate}T${f.kickoffTimeUtc}:00Z`,
    matchday:   f.matchDay      || null,
    gameId:     f.gameId        || null,
    provider:   f.provider      || null,
  }
}

function sortedFromMap(map) {
  return Array.from(map.values()).sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff))
}

export function useFixtures() {
  const [fixtures, setFixtures] = useState([])
  const [leagues,  setLeagues]  = useState([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(null)

  const fixtureMapRef  = useRef(new Map()) // id → fixture
  const versionMapRef  = useRef(new Map()) // leagueCode → version
  const leagueListRef  = useRef([])

  // ── Initial load ─────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const leagueList = await fetchLeagues()
        if (cancelled) return
        setLeagues(leagueList)
        leagueListRef.current = leagueList

        const results = await Promise.allSettled(leagueList.map(l => fetchFixtures(l.code)))
        if (cancelled) return

        const fMap = new Map()
        const vMap = new Map()
        results.forEach((r, i) => {
          if (r.status !== 'fulfilled') return
          const payload = r.value
          const league  = leagueList[i]
          if (payload.version != null) vMap.set(league.code, payload.version)
          ;(Array.isArray(payload.fixtures) ? payload.fixtures : []).forEach(f => {
            const norm = normalizeFixture(f, league)
            fMap.set(norm.id, norm)
          })
        })

        fixtureMapRef.current = fMap
        versionMapRef.current = vMap
        setFixtures(sortedFromMap(fMap))
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [])

  // ── Background poll: check versions, append only new fixtures ─────────────
  useEffect(() => {
    const timer = setInterval(async () => {
      const leagueList = leagueListRef.current
      if (!leagueList.length) return
      try {
        const status = await fetchScheduleStatus()
        const changed = leagueList.filter(l => {
          const serverVer = status.leagues?.[l.code]?.version
          return serverVer != null && serverVer !== versionMapRef.current.get(l.code)
        })
        if (!changed.length) return

        const results = await Promise.allSettled(changed.map(l => fetchFixtures(l.code)))
        let anyNew = false
        results.forEach((r, i) => {
          if (r.status !== 'fulfilled') return
          const payload = r.value
          const league  = changed[i]
          if (payload.version != null) versionMapRef.current.set(league.code, payload.version)
          ;(Array.isArray(payload.fixtures) ? payload.fixtures : []).forEach(f => {
            const norm = normalizeFixture(f, league)
            if (!fixtureMapRef.current.has(norm.id)) {
              fixtureMapRef.current.set(norm.id, norm)
              anyNew = true
            }
          })
        })
        if (anyNew) setFixtures(sortedFromMap(fixtureMapRef.current))
      } catch { /* ignore poll errors silently */ }
    }, POLL_INTERVAL_MS)

    return () => clearInterval(timer)
  }, [])

  return { fixtures, leagues, loading, error }
}
