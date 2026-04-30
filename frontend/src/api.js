const BASE = ''  // same origin in prod; proxied in dev

export async function fetchEnvironment() {
  const res = await fetch(`${BASE}/api/runtime/environment`)
  if (!res.ok) throw new Error(`fetchEnvironment failed: ${res.status}`)
  return res.json()
}

export async function switchEnvironment(code) {
  const res = await fetch(`${BASE}/api/runtime/environment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_env: code }),
  })
  if (!res.ok) throw new Error(`switchEnvironment failed: ${res.status}`)
  return res.json()
}

export async function fetchLeagues() {
  const res = await fetch(`${BASE}/api/schedules/leagues`)
  if (!res.ok) throw new Error(`fetchLeagues failed: ${res.status}`)
  const data = await res.json()
  return Array.isArray(data.leagues) ? data.leagues : []
}

export async function fetchScheduleStatus() {
  const res = await fetch(`${BASE}/api/schedules/status`)
  if (!res.ok) throw new Error(`fetchScheduleStatus failed: ${res.status}`)
  return res.json()
}

export async function fetchFixtures(leagueCode) {
  const res = await fetch(`${BASE}/api/schedules/upcoming?league=${encodeURIComponent(leagueCode)}`)
  if (!res.ok) throw new Error(`fetchFixtures(${leagueCode}) failed: ${res.status}`)
  return res.json()
}

export async function publishBatch({ fixtures, submarkets, environment }) {
  const res = await fetch(`${BASE}/api/cms/batch-publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fixtures, submarkets, environment }),
  })
  if (!res.ok && res.status !== 202) throw new Error(`publishBatch failed: ${res.status}`)
  return res.json()
}

export async function fetchBatchRun(runId) {
  const res = await fetch(`${BASE}/api/cms/batch-runs/${encodeURIComponent(runId)}`)
  if (!res.ok) throw new Error(`fetchBatchRun(${runId}) failed: ${res.status}`)
  return res.json()
}

export async function fetchJsonLeagues() {
  const res = await fetch(`${BASE}/api/json/leagues`)
  if (!res.ok) throw new Error(`fetchJsonLeagues failed: ${res.status}`)
  return res.json()
}

export async function publishJsonFixture(fixtureName, leagueId = '') {
  const body = { fixture_name: fixtureName }
  if (leagueId) body.league_id = leagueId
  const res = await fetch(`${BASE}/api/json/publish-fixture`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

export async function generateParentMarket(params) {
  const res = await fetch(`${BASE}/api/json/generate-parent-market`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

export async function publishJsonParentMarket(payload) {
  const res = await fetch(`${BASE}/api/json/publish-parent-market`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}
