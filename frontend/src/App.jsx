import { useState, useMemo, useEffect } from "react";
import { submarketGroups, ALL_SUBMARKET_IDS } from "./data.js";
import { useFixtures } from "./hooks/useFixtures.js";
import { useAuth } from "./hooks/useAuth.js";
import {
  publishBatch,
  fetchBatchRun,
  fetchEnvironment,
  switchEnvironment,
  scheduleBatchPublish,
  listScheduledJobs as apiListScheduledJobs,
  cancelScheduledJob as apiCancelScheduledJob,
  rescheduleJob as apiRescheduleJob,
} from "./api.js";
import { useTheme } from "./hooks/useTheme.js";
import Header from "./components/Header.jsx";
import TabBar from "./components/TabBar.jsx";
import BuilderView from "./components/BuilderView.jsx";
import FilterBar from "./components/FilterBar.jsx";
import FixtureTable from "./components/FixtureTable.jsx";
import SubmarketPanel from "./components/SubmarketPanel.jsx";
import SelectionBar from "./components/SelectionBar.jsx";
import ReviewOverlay from "./components/ReviewOverlay.jsx";
import ScheduleQueue from "./components/ScheduleQueue.jsx";
import JsonView from "./components/JsonView.jsx";
import LoginPage from "./components/LoginPage.jsx";

export default function App() {
  const { theme, toggle: toggleTheme } = useTheme();
  const { fixtures, loading: fixturesLoading, error } = useFixtures();
  const {
    user,
    loading: authLoading,
    error: authError,
    loadingGoogle,
    loadingEmail,
    linkSentTo,
    signInWithGoogle,
    sendMagicLink,
    resendMagicLink,
    resetLinkFlow,
    signOut,
  } = useAuth();

  const [activeEnv, setActiveEnv] = useState(null);
  const [environments, setEnvironments] = useState([]);
  const [tab, setTab] = useState("builder");
  const [builderSelection, setBuilderSelection] = useState(new Map());
  const [builderPublishSuccess, setBuilderPublishSuccess] = useState(false);
  const [submarkets, setSubmarkets] = useState(new Set());
  const [selected, setSelected] = useState(new Set());
  const [filters, setFilters] = useState({ league: "", date: "", matchday: "", search: "" });
  const [sort, setSort] = useState({ field: "kickoff", dir: "asc" });
  const [view, setView] = useState("list");
  const [queueOpen, setQueueOpen] = useState(false);
  const [scheduledJobs, setScheduledJobs] = useState([]);
  const [lastScheduledAt, setLastScheduledAt] = useState(null);
  const [lastActionMarkets, setLastActionMarkets] = useState(0);
  const [publishError, setPublishError] = useState(null);
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    fetchEnvironment()
      .then((data) => {
        setActiveEnv(data.active_env);
        setEnvironments(data.environments || []);
      })
      .catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    return fixtures
      .filter((f) => {
        if (filters.league && f.league !== filters.league) return false;
        if (filters.date && !f.kickoff.startsWith(filters.date)) return false;
        if (filters.matchday && f.matchday !== parseInt(filters.matchday, 10)) return false;
        if (filters.search) {
          const q = filters.search.toLowerCase();
          if (
            !f.home.toLowerCase().includes(q) &&
            !f.away.toLowerCase().includes(q) &&
            !f.league.toLowerCase().includes(q)
          )
            return false;
        }
        return true;
      })
      .sort((a, b) => {
        const aV = sort.field === "kickoff" ? new Date(a.kickoff).getTime() : 0;
        const bV = sort.field === "kickoff" ? new Date(b.kickoff).getTime() : 0;
        return sort.dir === "asc" ? aV - bV : bV - aV;
      });
  }, [fixtures, filters, sort]);

  const scheduledFixtureIds = useMemo(() => {
    const ids = new Set();
    scheduledJobs
      .filter((j) => j.status === "pending")
      .forEach((j) => j.fixtures.forEach((f) => ids.add(f.id)));
    return ids;
  }, [scheduledJobs]);

  const builderSelectedIds = useMemo(() => new Set(builderSelection.keys()), [builderSelection]);

  // Queue overlay refetch — kept above the early returns so React sees a
  // stable hook order between (authLoading=true) and (authLoading=false)
  // renders. Previously this lived below at the "Handlers" section and
  // triggered React error #310 ("more hooks than during the previous render")
  // the moment auth resolved.
  useEffect(() => {
    if (queueOpen && user) {
      // Resolution: refreshScheduledJobs is defined below but doesn't need
      // to be captured here — we look it up via closure each time the effect
      // fires, which is fine because it's stable across renders (no hooks
      // inside it). React only cares about the hook *count* and *order*.
      void refreshScheduledJobs();
    }
  }, [queueOpen, activeEnv?.code, user]);

  // ── Early returns (all hooks above) ──────────────────────────────────────
  if (authLoading) return null;

  if (!user)
    return (
      <LoginPage
        onSignInGoogle={signInWithGoogle}
        onSendMagicLink={sendMagicLink}
        onResendMagicLink={resendMagicLink}
        onResetLinkFlow={resetLinkFlow}
        loadingGoogle={loadingGoogle}
        loadingEmail={loadingEmail}
        linkSentTo={linkSentTo}
        error={authError}
      />
    );

  // ── Handlers ──────────────────────────────────────────────────────────────
  async function handleSwitchEnv(code) {
    try {
      const data = await switchEnvironment(code);
      setActiveEnv(data.active_env);
      setEnvironments(data.environments || []);
    } catch {}
  }

  function handleToggleBuilderFixture(fixture) {
    setBuilderSelection((prev) => {
      const next = new Map(prev);
      next.has(fixture.id) ? next.delete(fixture.id) : next.set(fixture.id, fixture);
      return next;
    });
  }

  function handleSelectAllBuilderFixtures(fixtures) {
    setBuilderSelection(new Map(fixtures.map((f) => [f.id, f])));
  }

  function handleClearBuilderFixtures() {
    setBuilderSelection(new Map());
  }

  async function handleBuilderPublish() {
    const fixturesArr = Array.from(builderSelection.values());
    if (!fixturesArr.length || !submarkets.size) return;
    setPublishing(true);
    setPublishError(null);
    try {
      const result = await publishBatch({
        fixtures: fixturesArr.map((f) => ({
          id: f.id,
          home: f.home || f.homeTeamName,
          away: f.away || f.awayTeamName,
          league: f.league || f.leagueName,
          leagueCode: f.leagueCode,
          kickoff: f.kickoff,
          matchday: f.matchday,
          gameId: f.gameId,
          provider: f.provider,
        })),
        submarkets: selectedSubmarkets.map((m) => m.id),
      });
      if (result.run_id) await pollRun(result.run_id);
      setBuilderSelection(new Map());
      setBuilderPublishSuccess(true);
      setTimeout(() => setBuilderPublishSuccess(false), 3000);
    } catch (err) {
      setPublishError(err.message);
    } finally {
      setPublishing(false);
    }
  }

  const hasSelection = selected.size > 0;
  const totalMarkets = selected.size * submarkets.size;
  const pendingJobCount = scheduledJobs.filter((j) => j.status === "pending").length;
  const selectedFixtures = fixtures.filter((f) => selected.has(f.id));
  const selectedSubmarkets = submarketGroups
    .flatMap((g) => g.markets)
    .filter((m) => submarkets.has(m.id));

  function toggleSubmarket(id) {
    setSubmarkets((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function toggleFixture(id) {
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function handleSort(field) {
    setSort((prev) =>
      prev.field === field
        ? { field, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { field, dir: "asc" }
    );
  }

  function clearSelection() {
    setSelected(new Set());
    setSubmarkets(new Set());
  }

  async function handlePublish(fixturesWithMarkets, totalMkts) {
    setPublishing(true);
    setPublishError(null);
    try {
      const result = await publishBatch({
        fixtures: fixturesWithMarkets.map((f) => ({
          id: f.id,
          home: f.home,
          away: f.away,
          league: f.league,
          leagueCode: f.leagueCode,
          kickoff: f.kickoff,
          matchday: f.matchday,
          gameId: f.gameId,
          provider: f.provider,
        })),
        submarkets: selectedSubmarkets.map((m) => m.id),
      });
      if (result.run_id) await pollRun(result.run_id);
      setLastActionMarkets(totalMkts);
      setView("done");
    } catch (err) {
      setPublishError(err.message);
    } finally {
      setPublishing(false);
    }
  }

  async function pollRun(runId) {
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const run = await fetchBatchRun(runId);
      if (["completed", "partial", "failed", "stopped"].includes(run.status)) {
        if (run.status === "failed") {
          // Surface the actual CMS error chain so operators don't have to
          // dig through Network tab / server logs to know why it failed.
          // Pulls from run.detail (top-level), then the first failed fixture's
          // reason, then falls back to the generic message.
          const firstFailed = (run.fixture_results || []).find((fr) => fr.status === "failed");
          const detail = run.detail || firstFailed?.reason || run.summary || "Publish run failed";
          throw new Error(detail);
        }
        return run;
      }
    }
    throw new Error("Publish run timed out");
  }

  function adaptBackendJob(backendJob) {
    const env = backendJob?.payload?.payload || {};
    const selFix = Array.isArray(env.selected_fixtures) ? env.selected_fixtures : [];
    const fixtures = selFix.map((sf) => {
      const [home, away] = String(sf.event_name || "").split(/\s+vs\s+/i);
      return {
        id: sf.game_id || sf.providerFixtureId || backendJob.job_id,
        home: home || sf.home_team_name || "",
        away: away || sf.away_team_name || "",
        leagueCode: sf.league_code || "",
        gameId: sf.game_id || "",
        kickoff:
          sf.fixture_date && sf.kickoff_time_utc
            ? `${sf.fixture_date}T${sf.kickoff_time_utc}:00Z`
            : "",
        // Backend stores publish_keys globally, not per-fixture, so the per-
        // fixture customSubmarkets list is empty in queue-rendered jobs.
        customSubmarkets: [],
      };
    });
    const publishKeyCount = Array.isArray(env.selected_publish_keys)
      ? env.selected_publish_keys.length
      : 0;
    return {
      id: backendJob.job_id,
      fixtures,
      totalMarkets: fixtures.length * publishKeyCount,
      scheduledAt: backendJob.scheduled_at,
      createdAt: backendJob.created_at,
      status: backendJob.status,
      backendStatus: backendJob.status,
      runId: backendJob.run_id || null,
      lastError: backendJob.last_error || null,
    };
  }

  async function refreshScheduledJobs() {
    const code = activeEnv?.code;
    if (!code) return;
    try {
      const data = await apiListScheduledJobs({ environment: code });
      const adapted = (data.jobs || []).map(adaptBackendJob);
      setScheduledJobs(adapted);
    } catch (err) {
      // Non-fatal — queue stays empty if the backend list call fails (e.g., DB not configured)
      console.warn("Failed to refresh scheduled jobs:", err.message);
    }
  }

  async function handleSchedule(scheduleAt, fixturesWithMarkets, totalMkts) {
    setPublishError(null);
    try {
      await scheduleBatchPublish({
        scheduledAt: scheduleAt,
        fixturesWithMarkets,
        environment: activeEnv?.code || "dev",
        requestedBy: user?.email || "operator",
      });
    } catch (err) {
      setPublishError(`Schedule failed: ${err.message}`);
      return;
    }
    setLastScheduledAt(scheduleAt);
    setLastActionMarkets(totalMkts);
    setView("job-scheduled");
    // Don't await — UI doesn't depend on the refresh, and queue overlay will
    // refetch on open anyway.
    void refreshScheduledJobs();
  }

  async function handleCancelScheduledJob(jobId) {
    try {
      await apiCancelScheduledJob(jobId);
    } catch (err) {
      console.error("Cancel failed:", err.message);
    }
    await refreshScheduledJobs();
  }

  async function handleRescheduleScheduledJob(jobId, newTime) {
    try {
      await apiRescheduleJob(jobId, newTime);
    } catch (err) {
      console.error("Reschedule failed:", err.message);
    }
    await refreshScheduledJobs();
  }

  function handleClearCancelledJobs() {
    // Cancelled jobs are surfaced from the backend list. The "clear" UX action
    // is purely visual now — we just refresh from the backend so completed/
    // failed/cancelled rows older than the list-window drop off naturally.
    // (No backend bulk-delete endpoint by design — keep an audit trail.)
    void refreshScheduledJobs();
  }

  function handleDone() {
    clearSelection();
    setPublishError(null);
    setView("list");
  }

  return (
    <div className="app">
      <Header
        theme={theme}
        onToggleTheme={toggleTheme}
        queueCount={pendingJobCount}
        onQueueOpen={() => setQueueOpen(true)}
        user={user}
        onSignOut={signOut}
        activeEnv={activeEnv}
        environments={environments}
        onSwitchEnv={handleSwitchEnv}
      />

      <TabBar tab={tab} onChange={setTab} />

      {tab === "builder" && (
        <>
          <BuilderView
            activeEnv={activeEnv}
            submarkets={submarkets}
            onToggle={toggleSubmarket}
            builderSelectedIds={builderSelectedIds}
            onToggleBuilderFixture={handleToggleBuilderFixture}
            onSelectAllBuilderFixtures={handleSelectAllBuilderFixtures}
            onClearBuilderFixtures={handleClearBuilderFixtures}
            onBuilderPublish={handleBuilderPublish}
            publishing={publishing}
            publishError={publishError}
            publishSuccess={builderPublishSuccess}
          />
        </>
      )}

      {tab === "fixtures" && (
        <>
          <FilterBar
            fixtures={fixtures}
            filters={filters}
            onChange={setFilters}
            count={filtered.length}
          />
          {error && (
            <div style={{ padding: "12px 20px", color: "var(--s-live)" }}>
              Failed to load fixtures: {error}
            </div>
          )}
          <div className="workspace">
            <FixtureTable
              fixtures={filtered}
              selected={selected}
              onToggle={toggleFixture}
              sort={sort}
              onSort={handleSort}
              scheduledIds={scheduledFixtureIds}
              loading={fixturesLoading}
            />
            <SubmarketPanel
              open={hasSelection}
              fixtureCount={selected.size}
              selected={submarkets}
              onToggle={toggleSubmarket}
              onSelectAll={() => setSubmarkets(new Set(ALL_SUBMARKET_IDS))}
              onClear={() => setSubmarkets(new Set())}
              onSetSubmarkets={(ids) => setSubmarkets(ids)}
            />
          </div>
          <SelectionBar
            visible={hasSelection}
            fixtureCount={selected.size}
            submarketCount={submarkets.size}
            totalMarkets={totalMarkets}
            onClear={clearSelection}
            onReview={() => setView("review")}
          />
          {view !== "list" && (
            <ReviewOverlay
              fixtures={selectedFixtures}
              submarkets={selectedSubmarkets}
              view={view}
              lastScheduledAt={lastScheduledAt}
              lastActionMarkets={lastActionMarkets}
              publishError={publishError}
              publishing={publishing}
              onBack={() => setView("list")}
              onPublish={handlePublish}
              onSchedule={handleSchedule}
              onDone={handleDone}
              onViewQueue={() => {
                handleDone();
                setQueueOpen(true);
              }}
            />
          )}
          {queueOpen && (
            <ScheduleQueue
              jobs={scheduledJobs}
              onCancel={handleCancelScheduledJob}
              onEditTime={handleRescheduleScheduledJob}
              onClearCancelled={handleClearCancelledJobs}
              onClose={() => setQueueOpen(false)}
            />
          )}
        </>
      )}

      {tab === "json" && <JsonView />}
    </div>
  );
}
