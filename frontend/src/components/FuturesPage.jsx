import { useState, useEffect } from "react";
import { fetchLeagues, fetchLeagueFutures, prefetchLeagueFutures } from "../api.js";
import FutureCard from "./FutureCard.jsx";
import FuturePublishDrawer from "./FuturePublishDrawer.jsx";
import EmptyState from "./EmptyState.jsx";

export default function FuturesPage({ activeEnv }) {
  const [leagues, setLeagues] = useState([]);
  const [activeLeague, setActiveLeague] = useState(null);
  const [futures, setFutures] = useState([]);
  const [loadingLeagues, setLoadingLeagues] = useState(true);
  const [loadingFutures, setLoadingFutures] = useState(false);
  const [error, setError] = useState(null);
  const [drawerFuture, setDrawerFuture] = useState(null);
  const [drawerInitialSelection, setDrawerInitialSelection] = useState(null);

  const envCode = activeEnv?.code ?? null;

  // Each fetch effect uses a local `cancelled` flag (matches the pattern in
  // SchedulePanel) so late-landing responses from a prior env or league
  // switch don't clobber the UI with stale data.
  useEffect(() => {
    let cancelled = false;
    setLoadingLeagues(true);
    setLeagues([]);
    setActiveLeague(null);
    fetchLeagues()
      .then((list) => {
        if (cancelled) return;
        setLeagues(list);
        if (list.length) setActiveLeague(list[0].code);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoadingLeagues(false);
      });
    return () => {
      cancelled = true;
    };
  }, [envCode]);

  useEffect(() => {
    if (!activeLeague) return;
    let cancelled = false;
    setLoadingFutures(true);
    setFutures([]);
    setError(null);
    // Always request readiness so each card can decide Publish vs Configure-only.
    fetchLeagueFutures(activeLeague, { withReadiness: true })
      .then((payload) => {
        if (cancelled) return;
        setFutures(Array.isArray(payload.futures) ? payload.futures : []);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoadingFutures(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeLeague]);

  // Cheap prefetch of OTHER leagues (no readiness) so tab switches feel snappy.
  // Side-effect-only — prefetched payloads land in the API layer's cache, so
  // the in-flight requests can safely complete after unmount; we just drop
  // any per-fetch error reporting so a failing league doesn't surface here.
  useEffect(() => {
    if (!leagues.length || !activeLeague) return;
    const others = leagues.filter((l) => l.code !== activeLeague);
    for (const l of others) {
      prefetchLeagueFutures(l.code).catch(() => {});
    }
  }, [leagues, activeLeague]);

  return (
    <div className="futures-page">
      <div className="futures-page__hdr">
        <h2 className="futures-page__title">League Futures</h2>
        <span className="futures-page__hint">
          Polymarket-sourced. Click Publish to ship with defaults, or Configure to edit.
        </span>
      </div>

      {loadingLeagues && (
        <EmptyState tone="loading" title="Loading leagues…" hint="Talking to the catalog." />
      )}

      {leagues.length > 0 && (
        <div className="league-tabs">
          {leagues.map((l) => (
            <button
              key={l.code}
              className={`league-tab${activeLeague === l.code ? " league-tab--active" : ""}`}
              onClick={() => setActiveLeague(l.code)}
            >
              {l.label}
            </button>
          ))}
        </div>
      )}

      <div className="futures-page__body">
        {loadingFutures && (
          <EmptyState
            tone="loading"
            title="Loading futures…"
            hint="Fetching live odds from Polymarket."
          />
        )}
        {error && <EmptyState tone="error" icon="!" title="Couldn't load futures" hint={error} />}
        {!loadingFutures && !error && futures.length === 0 && (
          <EmptyState
            icon="∅"
            title="No futures for this league"
            hint="Polymarket has no active futures markets here yet — try another league."
          />
        )}
        {futures.map((f) => (
          <FutureCard
            key={f.future_key}
            future={f}
            leagueCode={activeLeague}
            environment={envCode || "dev"}
            onConfigure={(selectedIds) => {
              setDrawerInitialSelection(selectedIds || null);
              setDrawerFuture(f);
            }}
          />
        ))}
      </div>

      <FuturePublishDrawer
        open={Boolean(drawerFuture)}
        future={drawerFuture}
        leagueCode={activeLeague}
        environment={envCode || "dev"}
        initialSelectedIds={drawerInitialSelection}
        onClose={() => {
          setDrawerFuture(null);
          setDrawerInitialSelection(null);
        }}
      />
    </div>
  );
}
