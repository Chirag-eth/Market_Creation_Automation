const BASE = ""; // same origin in prod; proxied in dev

export async function fetchEnvironment() {
  const res = await fetch(`${BASE}/api/runtime/environment`);
  if (!res.ok) throw new Error(`fetchEnvironment failed: ${res.status}`);
  return res.json();
}

export async function switchEnvironment(code) {
  const res = await fetch(`${BASE}/api/runtime/environment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_env: code }),
  });
  if (!res.ok) throw new Error(`switchEnvironment failed: ${res.status}`);
  return res.json();
}

export async function fetchAllSchedules() {
  const res = await fetch(`${BASE}/api/schedules/all`);
  if (!res.ok) throw new Error(`fetchAllSchedules failed: ${res.status}`);
  return res.json();
}

export async function fetchScheduleStatus() {
  const res = await fetch(`${BASE}/api/schedules/status`);
  if (!res.ok) throw new Error(`fetchScheduleStatus failed: ${res.status}`);
  return res.json();
}

export async function fetchLeagues() {
  const res = await fetch(`${BASE}/api/schedules/leagues`);
  if (!res.ok) throw new Error(`fetchLeagues failed: ${res.status}`);
  const data = await res.json();
  return Array.isArray(data.leagues) ? data.leagues : [];
}

export async function fetchFixtures(leagueCode) {
  const res = await fetch(
    `${BASE}/api/schedules/upcoming?league=${encodeURIComponent(leagueCode)}`
  );
  if (!res.ok) throw new Error(`fetchFixtures(${leagueCode}) failed: ${res.status}`);
  return res.json();
}

export async function fetchLeagueFutures(
  leagueCode,
  { refresh = false, withReadiness = false } = {}
) {
  const params = new URLSearchParams({ league: leagueCode });
  if (refresh) params.set("refresh", "1");
  if (withReadiness) params.set("with_readiness", "1");
  const res = await fetch(`${BASE}/api/futures/league?${params}`);
  if (!res.ok) throw new Error(`fetchLeagueFutures(${leagueCode}) failed: ${res.status}`);
  return res.json();
}

export async function prefetchLeagueFutures(leagueCode) {
  const params = new URLSearchParams({ league: leagueCode });
  const res = await fetch(`${BASE}/api/futures/prefetch?${params}`);
  if (!res.ok) return { ok: false };
  return res.json();
}

export async function fetchFutureTemplate(futureKey) {
  const params = new URLSearchParams({ future_key: futureKey });
  const res = await fetch(`${BASE}/api/futures/template?${params}`);
  if (!res.ok) throw new Error(`fetchFutureTemplate failed: ${res.status}`);
  return res.json();
}

export async function resolveFuturesCatalog({ environment, leagueCode, outcomeNames }) {
  const res = await fetch(`${BASE}/api/futures/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      environment,
      league_code: leagueCode,
      outcome_names: outcomeNames,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export async function publishFutures(envelope) {
  const res = await fetch(`${BASE}/api/cms/publish-futures`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(envelope),
  });
  const data = await res.json();
  if (!res.ok && res.status !== 202) {
    const issues = data?.extras?.issues || [];
    const detail = issues.length ? issues.join(", ") : data.error || `HTTP ${res.status}`;
    throw new Error(`publishFutures failed: ${detail}`);
  }
  return data;
}

export async function previewFuture(input) {
  const res = await fetch(`${BASE}/api/cms/preview-future`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await res.json();
  if (!res.ok) {
    const issues = data?.extras?.issues || [];
    const detail = issues.length ? issues.join(", ") : data.error || `HTTP ${res.status}`;
    throw new Error(`previewFuture failed: ${detail}`);
  }
  return data;
}

export async function publishFutureQuick(input) {
  const res = await fetch(`${BASE}/api/cms/publish-future-quick`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await res.json();
  if (!res.ok && res.status !== 202) {
    const issues = data?.extras?.issues || [];
    const detail = issues.length ? issues.join(", ") : data.error || `HTTP ${res.status}`;
    throw new Error(`publishFutureQuick failed: ${detail}`);
  }
  return data;
}

export async function fetchFuturesRun(runId) {
  const res = await fetch(`${BASE}/api/cms/futures-runs/${encodeURIComponent(runId)}`);
  if (!res.ok) throw new Error(`fetchFuturesRun(${runId}) failed: ${res.status}`);
  return res.json();
}

export async function publishBatch({ fixtures, submarkets, environment, sport, perFixtureLines }) {
  const body = { fixtures, submarkets, environment };
  if (sport) body.sport = sport;
  if (perFixtureLines && typeof perFixtureLines === "object") {
    body.per_fixture_lines = perFixtureLines;
  }
  const res = await fetch(`${BASE}/api/cms/batch-publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 202) {
    const details = Array.isArray(data?.details) ? data.details : [];
    const detailText = details
      .map((entry) => String(entry?.message || "").trim())
      .filter(Boolean)
      .join("; ");
    const reason = detailText || String(data?.error || "").trim() || `HTTP ${res.status}`;
    throw new Error(`publishBatch failed: ${reason}`);
  }
  return data;
}

// Given a list of schedule fixtures, returns which are already published in
// the active env's CMS. Used to split the Builder list into Upcoming + Existing.
// Backend matches by canonical_name in type_references (deterministic from
// the same buildFixtureCreateCname we use at publish time).
export async function checkExistingFixtures({ environment, fixtures }) {
  const res = await fetch(`${BASE}/api/cms/check-existing`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ environment, fixtures }),
  });
  if (!res.ok) throw new Error(`checkExistingFixtures failed: ${res.status}`);
  return res.json();
}

export async function fetchBatchRun(runId) {
  const res = await fetch(`${BASE}/api/cms/batch-runs/${encodeURIComponent(runId)}`);
  if (!res.ok) throw new Error(`fetchBatchRun(${runId}) failed: ${res.status}`);
  return res.json();
}

export async function fetchJsonLeagues() {
  const res = await fetch(`${BASE}/api/json/leagues`);
  if (!res.ok) throw new Error(`fetchJsonLeagues failed: ${res.status}`);
  return res.json();
}

export async function publishJsonFixture(fixtureName, leagueId = "") {
  const body = { fixture_name: fixtureName };
  if (leagueId) body.league_id = leagueId;
  const res = await fetch(`${BASE}/api/json/publish-fixture`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export async function generateParentMarket(params) {
  const res = await fetch(`${BASE}/api/json/generate-parent-market`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export async function searchJsonTeams(q, leagueId = "") {
  const params = new URLSearchParams({ q });
  if (leagueId) params.set("league_id", leagueId);
  const res = await fetch(`${BASE}/api/json/teams?${params}`);
  if (!res.ok) return { teams: [] };
  return res.json();
}

export async function buildJsonOutputs({
  fixtureName,
  homeTeam,
  homeTeamId,
  homeTeamAlt,
  awayTeam,
  awayTeamId,
  awayTeamAlt,
  leagueName,
  leagueId,
  kickoffIso,
  typeReferenceId,
  leaves,
}) {
  const res = await fetch(`${BASE}/api/json/build-outputs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fixture_name: fixtureName,
      home_team: homeTeam,
      home_team_id: homeTeamId,
      home_team_alt: homeTeamAlt,
      away_team: awayTeam,
      away_team_id: awayTeamId,
      away_team_alt: awayTeamAlt,
      league_name: leagueName,
      league_id: leagueId,
      kickoff_iso: kickoffIso,
      type_reference_id: typeReferenceId,
      leaves,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export async function prepareJsonPublish(
  fixturePayload,
  leagueSlug = "",
  homeTeamName = "",
  awayTeamName = ""
) {
  const res = await fetch(`${BASE}/api/json/prepare-publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fixture_payload: fixturePayload,
      league_slug: leagueSlug,
      home_team_name: homeTeamName,
      away_team_name: awayTeamName,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export async function createCmsFixture({ gameId, source, parentMarkets, cname, appendix = "" }) {
  const res = await fetch(`${BASE}/api/cms/fixture-create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      game_id: gameId,
      source,
      parent_markets: parentMarkets,
      cname,
      appendix,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || data?.error || `HTTP ${res.status}`);
  return data;
}

export async function publishJsonParentMarket(payload) {
  const res = await fetch(`${BASE}/api/json/publish-parent-market`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payload }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ─── Scheduled-publish (DB-backed) ──────────────────────────────────────────

function fixturesToSelectedFixtures(fixturesWithMarkets) {
  return fixturesWithMarkets.map((f) => ({
    game_id: String(f.game_id || f.gameId || f.id || ""),
    event_name: String(
      f.event_name || `${f.home || f.homeTeamName || ""} vs ${f.away || f.awayTeamName || ""}`
    ),
    fixture_date: String(f.fixture_date || f.fixtureDate || ""),
    kickoff_time_utc: String(f.kickoff_time_utc || f.kickoffTimeUtc || ""),
    league_code: String(f.league_code || f.leagueCode || ""),
    provider: f.provider || f.source || undefined,
    polymarket_url: f.polymarket_url || f.polymarketUrl || undefined,
    polymarket_event_id:
      f.polymarket_event_id || f.polymarketEventId || f.sourceMeta?.polymarketEventId || undefined,
  }));
}

function publishKeysFromFixtures(fixturesWithMarkets) {
  const keys = new Set();
  for (const f of fixturesWithMarkets) {
    for (const m of f.customSubmarkets ?? []) {
      keys.add(`${m.id}|0`);
    }
  }
  return [...keys];
}

export async function scheduleBatchPublish({
  scheduledAt,
  fixturesWithMarkets,
  environment,
  requestId,
  requestedBy = "operator",
}) {
  const envelope = {
    environment,
    action: "schedule-publish",
    request_id: requestId || `sched_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    requested_by: requestedBy,
    payload: {
      selected_fixtures: fixturesToSelectedFixtures(fixturesWithMarkets),
      selected_publish_keys: publishKeysFromFixtures(fixturesWithMarkets),
      confirmation: {
        operator_name: requestedBy,
        fixture_count: String(fixturesWithMarkets.length),
        confirmed: true,
      },
      scheduled_at: new Date(scheduledAt).toISOString(),
    },
  };
  const res = await fetch(`${BASE}/api/integrations/cms/schedule-publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(envelope),
  });
  const data = await res.json();
  if (!res.ok) {
    const issues = data?.extras?.issues || [];
    const detail = issues.length ? issues.join(", ") : data?.error || `HTTP ${res.status}`;
    throw new Error(`scheduleBatchPublish failed: ${detail}`);
  }
  return data;
}

export async function listScheduledJobs({ environment, status } = {}) {
  const params = new URLSearchParams();
  if (environment) params.set("environment", environment);
  if (status) params.set("status", status);
  const qs = params.toString();
  const res = await fetch(`${BASE}/api/integrations/cms/scheduled-jobs${qs ? `?${qs}` : ""}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export async function cancelScheduledJob(jobId) {
  const res = await fetch(
    `${BASE}/api/integrations/cms/scheduled-jobs/${encodeURIComponent(jobId)}/cancel`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export async function rescheduleJob(jobId, scheduledAt) {
  const res = await fetch(
    `${BASE}/api/integrations/cms/scheduled-jobs/${encodeURIComponent(jobId)}/reschedule`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scheduled_at: new Date(scheduledAt).toISOString() }),
    }
  );
  const data = await res.json();
  if (!res.ok) {
    const issues = data?.extras?.issues || [];
    const detail = issues.length ? issues.join(", ") : data?.error || `HTTP ${res.status}`;
    throw new Error(`rescheduleJob failed: ${detail}`);
  }
  return data;
}
