import { useState, useEffect, useRef } from 'react'
import { fetchAllSchedules, fetchScheduleStatus } from '../api.js'

const POLL_INTERVAL_MS = 60_000

function normalizeFixture(f, leagueCode, leagueLabel) {
  return {
    id:         f.providerFixtureId || f.fixture_id || `${leagueCode}-${f.eventName}`,
    home:       f.homeTeamName  || '',
    away:       f.awayTeamName  || '',
    league:     leagueLabel    || leagueCode,
    leagueCode,
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

  // ── Initial load: single request for all leagues ─────────────────────────
  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const data = await fetchAllSchedules()
        if (cancelled) return

        const leagueList = data.leagues || []
        setLeagues(leagueList)
        leagueListRef.current = leagueList

        const fMap = new Map()
        const vMap = new Map()
        for (const league of leagueList) {
          const sched = data.schedules?.[league.code]
          if (!sched) continue
          if (sched.version != null) vMap.set(league.code, sched.version)
          for (const f of Array.isArray(sched.fixtures) ? sched.fixtures : []) {
            const norm = normalizeFixture(f, league.code, league.label)
            fMap.set(norm.id, norm)
          }
        }

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

  // ── Background poll: check versions, re-fetch only changed leagues ────────
  useEffect(() => {
    const timer = setInterval(async () => {
      const leagueList = leagueListRef.current
      if (!leagueList.length) return
      try {
        const status = await fetchScheduleStatus()
        const changedCodes = new Set(
          leagueList
            .filter(l => {
              const serverVer = status.leagues?.[l.code]?.version
              return serverVer != null && serverVer !== versionMapRef.current.get(l.code)
            })
            .map(l => l.code)
        )
        if (!changedCodes.size) return

        // One round-trip gets the refreshed data for all changed leagues
        const data = await fetchAllSchedules()
        let anyNew = false
        for (const league of leagueList) {
          if (!changedCodes.has(league.code)) continue
          const sched = data.schedules?.[league.code]
          if (!sched) continue
          if (sched.version != null) versionMapRef.current.set(league.code, sched.version)
          for (const f of Array.isArray(sched.fixtures) ? sched.fixtures : []) {
            const norm = normalizeFixture(f, league.code, league.label)
            if (!fixtureMapRef.current.has(norm.id)) {
              fixtureMapRef.current.set(norm.id, norm)
              anyNew = true
            }
          }
        }
        if (anyNew) setFixtures(sortedFromMap(fixtureMapRef.current))
      } catch { /* ignore poll errors silently */ }
    }, POLL_INTERVAL_MS)

    return () => clearInterval(timer)
  }, [])

  return { fixtures, leagues, loading, error }
}
