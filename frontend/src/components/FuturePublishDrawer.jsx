import { useState, useEffect, useMemo } from "react";
import {
  fetchFutureTemplate,
  resolveFuturesCatalog,
  publishFutures,
  fetchFuturesRun,
} from "../api.js";

function deriveDefaultSeason(future) {
  if (future?.endDate) {
    const y = new Date(future.endDate).getUTCFullYear();
    if (Number.isFinite(y)) return String(y);
  }
  return String(new Date().getUTCFullYear());
}

function deriveDefaultMode(future) {
  return future?.negRisk ? "single-winner" : "multi-winner";
}

export default function FuturePublishDrawer({
  open,
  onClose,
  future,
  leagueCode,
  environment,
  initialSelectedIds,
}) {
  const [template, setTemplate] = useState(null);
  const [resolveResult, setResolveResult] = useState(null);
  const [overrides, setOverrides] = useState({}); // name → team_id
  const [outcomeSelection, setOutcomeSelection] = useState(new Set());
  const [title, setTitle] = useState("");
  const [parentRules, setParentRules] = useState("");
  const [marketCodeTemplate, setMarketCodeTemplate] = useState("");
  const [marketRulesTemplate, setMarketRulesTemplate] = useState("");
  const [marketsOpenTime, setMarketsOpenTime] = useState("");
  const [season, setSeason] = useState("");
  const [mode, setMode] = useState("multi-winner");
  const [runState, setRunState] = useState(null);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState(null);
  const [loadingTemplate, setLoadingTemplate] = useState(false);

  // Drawer owns its own selection state. Defaults to every active outcome on
  // the future; operator can untick to exclude long-shots before publishing.
  const selectedOutcomes = useMemo(() => {
    if (!future?.outcomes) return [];
    return future.outcomes.filter((o) => outcomeSelection.has(o.polymarket_market_id));
  }, [future, outcomeSelection]);

  function toggleOutcome(polymarketMarketId) {
    setOutcomeSelection((prev) => {
      const next = new Set(prev);
      if (next.has(polymarketMarketId)) next.delete(polymarketMarketId);
      else next.add(polymarketMarketId);
      return next;
    });
  }

  // Load defaults whenever the drawer opens for a new future.
  useEffect(() => {
    if (!open || !future) return;
    let cancelled = false;
    setError(null);
    setRunState(null);
    setOverrides({});
    setLoadingTemplate(true);
    // Initialize from the card's current selection if provided; otherwise
    // default to every active outcome (preserves the standalone-drawer case).
    if (initialSelectedIds instanceof Set && initialSelectedIds.size > 0) {
      setOutcomeSelection(new Set(initialSelectedIds));
    } else {
      setOutcomeSelection(new Set((future.outcomes || []).map((o) => o.polymarket_market_id)));
    }
    const defaultSeason = deriveDefaultSeason(future);
    setSeason(defaultSeason);
    setMode(deriveDefaultMode(future));
    setMarketsOpenTime(future?.endDate || "");

    fetchFutureTemplate(future.future_key)
      .then((data) => {
        if (cancelled) return;
        const t = data?.template || {};
        setTemplate(t);
        setTitle(t.title || future.title || "");
        setParentRules(t.parent_rules || "");
        setMarketCodeTemplate(t.market_code_template || "");
        setMarketRulesTemplate(t.market_rules_template || "");
      })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoadingTemplate(false));

    return () => {
      cancelled = true;
    };
  }, [open, future]);

  // Resolve team mappings whenever outcomes change.
  useEffect(() => {
    if (!open || !future || selectedOutcomes.length === 0) {
      setResolveResult(null);
      return;
    }
    let cancelled = false;
    resolveFuturesCatalog({
      environment,
      leagueCode,
      outcomeNames: selectedOutcomes.map((o) => o.name),
    })
      .then((data) => !cancelled && setResolveResult(data))
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [open, future, leagueCode, environment, selectedOutcomes]);

  const unmatchedNames = useMemo(() => {
    if (!resolveResult) return [];
    return (resolveResult.unmatched || []).map((u) => u.name);
  }, [resolveResult]);

  const unmatchedWithoutOverride = useMemo(
    () => unmatchedNames.filter((n) => !overrides[n]),
    [unmatchedNames, overrides]
  );

  function handlePublish() {
    setError(null);
    setPublishing(true);
    const envelope = {
      environment,
      league_code: leagueCode,
      future_key: future.future_key,
      polymarket_event_id: future.polymarket_event_id,
      season,
      title,
      parent_rules: parentRules,
      market_code_template: marketCodeTemplate,
      market_rules_template: marketRulesTemplate,
      markets_open_time: marketsOpenTime,
      mode,
      selected_outcomes: selectedOutcomes.map((o) => ({
        polymarket_market_id: o.polymarket_market_id,
        name: o.name,
        ...(overrides[o.name] ? { team_id_override: overrides[o.name] } : {}),
      })),
    };
    publishFutures(envelope)
      .then((data) => {
        if (!data?.run_id) throw new Error("publish returned no run_id");
        pollRun(data.run_id);
      })
      .catch((e) => {
        setError(e.message);
        setPublishing(false);
      });
  }

  function pollRun(runId, attempt = 0) {
    if (attempt > 60) {
      setError("Run timed out — check /api/cms/futures-runs for status");
      setPublishing(false);
      return;
    }
    fetchFuturesRun(runId)
      .then((data) => {
        const r = data?.run;
        setRunState(r);
        if (!r) {
          setError("run not found");
          setPublishing(false);
          return;
        }
        if (r.status === "queued" || r.status === "running") {
          setTimeout(() => pollRun(runId, attempt + 1), 1500);
        } else {
          setPublishing(false);
          if (r.status === "failed") setError(r.detail || "publish failed");
        }
      })
      .catch((e) => {
        setError(e.message);
        setPublishing(false);
      });
  }

  if (!open) return null;

  const canPublish =
    !publishing &&
    !!title &&
    !!parentRules &&
    !!marketCodeTemplate &&
    !!marketRulesTemplate &&
    !!marketsOpenTime &&
    !!season &&
    selectedOutcomes.length > 0 &&
    unmatchedWithoutOverride.length === 0;

  return (
    <div className="fpd-overlay" onClick={onClose}>
      <div className="fpd" onClick={(e) => e.stopPropagation()}>
        <div className="fpd__hdr">
          <div className="fpd__title">Publish: {future?.title}</div>
          <button className="fpd__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="fpd__body">
          {loadingTemplate && <div className="fpd__hint">Loading template…</div>}
          {template?._fallback && (
            <div className="fpd__warn">
              No server-side template found for `{future.future_key}`. Fill in rules manually below.
            </div>
          )}

          <label className="fpd__label">Title</label>
          <input className="fpd__input" value={title} onChange={(e) => setTitle(e.target.value)} />

          <label className="fpd__label">Season</label>
          <input
            className="fpd__input fpd__input--narrow"
            value={season}
            onChange={(e) => setSeason(e.target.value)}
          />

          <label className="fpd__label">Mode</label>
          <div className="fpd__mode">
            <label
              className={`fpd__mode-opt${mode === "single-winner" ? " fpd__mode-opt--active" : ""}`}
            >
              <input
                type="radio"
                name="fpd-mode"
                value="single-winner"
                checked={mode === "single-winner"}
                onChange={() => setMode("single-winner")}
              />
              Single-winner (mutually exclusive)
            </label>
            <label
              className={`fpd__mode-opt${mode === "multi-winner" ? " fpd__mode-opt--active" : ""}`}
            >
              <input
                type="radio"
                name="fpd-mode"
                value="multi-winner"
                checked={mode === "multi-winner"}
                onChange={() => setMode("multi-winner")}
              />
              Multi-winner (independent)
            </label>
            <span className="fpd__mode-hint">Default from negRisk = {String(future?.negRisk)}</span>
          </div>

          <label className="fpd__label">Markets open time (UTC)</label>
          <input
            type="datetime-local"
            className="fpd__input"
            value={marketsOpenTime ? marketsOpenTime.slice(0, 16) : ""}
            onChange={(e) => {
              const v = e.target.value;
              setMarketsOpenTime(v ? `${v}:00Z` : "");
            }}
          />

          <label className="fpd__label">Parent rules</label>
          <textarea
            className="fpd__textarea"
            rows={8}
            value={parentRules}
            onChange={(e) => setParentRules(e.target.value)}
          />

          <label className="fpd__label">Market code template</label>
          <input
            className="fpd__input"
            value={marketCodeTemplate}
            onChange={(e) => setMarketCodeTemplate(e.target.value)}
            placeholder="{team} to reach final (UCL)"
          />

          <label className="fpd__label">Market rules template</label>
          <textarea
            className="fpd__textarea"
            rows={4}
            value={marketRulesTemplate}
            onChange={(e) => setMarketRulesTemplate(e.target.value)}
          />

          <div className="fpd__section">
            <div className="fpd__label">
              Outcomes ({selectedOutcomes.length} of {(future?.outcomes || []).length} selected)
            </div>
            {!resolveResult && <div className="fpd__hint">Resolving catalog…</div>}
            <ul className="fpd__outcomes">
              {(future?.outcomes || []).map((o) => {
                const matched = (resolveResult?.matched || []).find((m) => m.name === o.name);
                const isUnmatched = resolveResult && !matched;
                const isChecked = outcomeSelection.has(o.polymarket_market_id);
                return (
                  <li
                    key={o.polymarket_market_id}
                    className={`fpd__outcome${isUnmatched ? " fpd__outcome--unmatched" : ""}`}
                  >
                    <label className="fpd__outcome-toggle">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleOutcome(o.polymarket_market_id)}
                      />
                      <span className="fpd__outcome-name">{o.name}</span>
                    </label>
                    {matched ? (
                      <span className="fpd__outcome-status fpd__outcome-status--ok">
                        → {matched.team_name}
                      </span>
                    ) : isUnmatched ? (
                      <input
                        className="fpd__override"
                        placeholder="Paste team_id UUID to override"
                        value={overrides[o.name] || ""}
                        onChange={(e) =>
                          setOverrides((prev) => ({ ...prev, [o.name]: e.target.value.trim() }))
                        }
                      />
                    ) : (
                      <span className="fpd__outcome-status">resolving…</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          {error && <div className="fpd__error">{error}</div>}
          {runState && (
            <div className="fpd__run">
              <div>
                Run: <code>{runState.run_id}</code> — status <b>{runState.status}</b>
              </div>
              {Array.isArray(runState.markets) && runState.markets.length > 0 && (
                <ul className="fpd__run-markets">
                  {runState.markets.map((m) => (
                    <li key={m.market_code}>
                      {m.market_code} — <b>{m.status}</b>
                      {m.reason ? ` (${m.reason})` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="fpd__footer">
          <button className="fpd__btn fpd__btn--ghost" onClick={onClose} disabled={publishing}>
            Cancel
          </button>
          <button
            className="fpd__btn fpd__btn--primary"
            onClick={handlePublish}
            disabled={!canPublish}
          >
            {publishing ? "Publishing…" : "Publish"}
          </button>
        </div>
      </div>
    </div>
  );
}
