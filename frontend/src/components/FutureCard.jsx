import { useState, useMemo, useEffect, useRef } from "react";
import { publishFutureQuick, fetchFuturesRun, previewFuture } from "../api.js";

function fmtProbability(p) {
  if (typeof p !== "number" || !Number.isFinite(p)) return "—";
  return `${(p * 100).toFixed(0)}%`;
}

function statusBlurb(run) {
  if (!run) return null;
  if (run.status === "queued" || run.status === "running") return "Publishing…";
  if (run.status === "completed") {
    const published = (run.markets || []).filter((m) => m.status === "published").length;
    const existing = (run.markets || []).filter((m) => m.status === "existing").length;
    if (existing > 0 && published === 0) return `Already published (${existing} markets)`;
    if (existing > 0) return `Published ${published} new, ${existing} already existed`;
    return `Published ${published} markets`;
  }
  if (run.status === "partial") {
    const failed = (run.markets || []).filter((m) => m.status === "failed").length;
    const ok = (run.markets || []).filter((m) => m.status === "published").length;
    return `Partial: ${ok} ok, ${failed} failed`;
  }
  if (run.status === "failed") return `Failed: ${run.detail || "unknown error"}`;
  return run.status;
}

export default function FutureCard({ future, leagueCode, environment, onConfigure }) {
  const outcomes = Array.isArray(future.outcomes) ? future.outcomes : [];
  const readiness = future.readiness;
  // Default-checked when Polymarket has a real price for that outcome. The
  // "League D/E/G/J/L" type placeholders show `—` (null probability) and
  // start unchecked so they don't accidentally ship as empty markets.
  const [selectedIds, setSelectedIds] = useState(
    () =>
      new Set(
        outcomes.filter((o) => typeof o.probability === "number").map((o) => o.polymarket_market_id)
      )
  );
  const [run, setRun] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(null);

  // Tracks whether the card is still mounted so the recursive pollRun setTimeout
  // chain can short-circuit after unmount. Without this, a publish that takes
  // ~60s keeps firing setRun/setBusy on a dead component if the operator
  // switches env or league mid-flight.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const selectedOutcomes = useMemo(
    () => outcomes.filter((o) => selectedIds.has(o.polymarket_market_id)),
    [outcomes, selectedIds]
  );

  // Recompute quick-publish eligibility against the *current* selection, not
  // the whole future. Server-side readiness is computed for all outcomes; if
  // an operator unchecks the unmatched ones, Publish should become available.
  const canQuick = useMemo(() => {
    if (!readiness?.template_available) return false;
    if (selectedOutcomes.length === 0) return false;
    const unmatched = new Set(readiness.unmatched_names || []);
    return !selectedOutcomes.some((o) => unmatched.has(o.name));
  }, [readiness, selectedOutcomes]);

  function toggleOutcome(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    // Selection changed → invalidate cached preview so re-expand refetches.
    setPreview(null);
    setPreviewError(null);
  }

  function pollRun(runId, attempt = 0) {
    if (!mountedRef.current) return;
    if (attempt > 60) {
      setError("Run timed out — check /api/cms/futures-runs");
      setBusy(false);
      return;
    }
    fetchFuturesRun(runId)
      .then((data) => {
        if (!mountedRef.current) return;
        const r = data?.run;
        setRun(r || null);
        if (!r) return setBusy(false);
        if (r.status === "queued" || r.status === "running") {
          setTimeout(() => pollRun(runId, attempt + 1), 1500);
        } else {
          setBusy(false);
        }
      })
      .catch((e) => {
        if (!mountedRef.current) return;
        setError(e.message);
        setBusy(false);
      });
  }

  function handlePublish() {
    if (!canQuick || busy) return;
    setError(null);
    setRun({ status: "queued" });
    setBusy(true);
    publishFutureQuick({
      environment,
      league_code: leagueCode,
      future_key: future.future_key,
      polymarket_event_id: future.polymarket_event_id,
      end_date: future.endDate,
      negRisk: future.negRisk,
      outcomes: selectedOutcomes.map((o) => ({
        name: o.name,
        polymarket_market_id: o.polymarket_market_id,
      })),
    })
      .then((data) => {
        if (!data?.run_id) throw new Error("publish returned no run_id");
        pollRun(data.run_id);
      })
      .catch((e) => {
        setError(e.message);
        setBusy(false);
        setRun(null);
      });
  }

  function togglePreview() {
    if (previewOpen) {
      setPreviewOpen(false);
      return;
    }
    setPreviewOpen(true);
    if (preview || previewLoading) return; // already loaded
    setPreviewLoading(true);
    setPreviewError(null);
    previewFuture({
      environment,
      league_code: leagueCode,
      future_key: future.future_key,
      polymarket_event_id: future.polymarket_event_id,
      end_date: future.endDate,
      negRisk: future.negRisk,
      outcomes: selectedOutcomes.map((o) => ({
        name: o.name,
        polymarket_market_id: o.polymarket_market_id,
      })),
    })
      .then((data) => setPreview(data))
      .catch((e) => setPreviewError(e.message))
      .finally(() => setPreviewLoading(false));
  }

  // Compute live tooltip from the actual selection so the message reflects
  // what the operator currently has checked, not the whole future.
  const tooltip = (() => {
    if (selectedOutcomes.length === 0) return "Select at least one outcome to publish.";
    if (!readiness?.template_available)
      return "No template seeded for this future. Use Configure to author rules.";
    const unmatchedSet = new Set(readiness?.unmatched_names || []);
    const selectedUnmatched = selectedOutcomes
      .filter((o) => unmatchedSet.has(o.name))
      .map((o) => o.name);
    if (selectedUnmatched.length > 0) {
      const sample = selectedUnmatched.slice(0, 3).join(", ");
      const more = selectedUnmatched.length > 3 ? ` and ${selectedUnmatched.length - 3} more` : "";
      return `${selectedUnmatched.length} selected outcome${selectedUnmatched.length === 1 ? "" : "s"} unmatched: ${sample}${more}. Use Configure to override, or uncheck them.`;
    }
    return "";
  })();
  const blurb = statusBlurb(run);
  const previewDisabled = !canQuick;
  const previewTooltip = previewDisabled ? tooltip : "";

  return (
    <div className="future-card">
      <div className="future-card__hdr">
        <div className="future-card__title">{future.title}</div>
        {future.endDate && (
          <div className="future-card__end">
            ends{" "}
            {new Date(future.endDate).toLocaleDateString("en-GB", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </div>
        )}
      </div>

      <div className="future-card__outcomes">
        {outcomes.map((o) => {
          const isChecked = selectedIds.has(o.polymarket_market_id);
          return (
            <label
              key={o.polymarket_market_id}
              className={`future-outcome${isChecked ? " future-outcome--active" : ""}`}
            >
              <input
                type="checkbox"
                className="cb future-outcome__cb"
                checked={isChecked}
                onChange={() => toggleOutcome(o.polymarket_market_id)}
                disabled={busy}
              />
              <span className="future-outcome__name">{o.name}</span>
              <span className="future-outcome__prob">{fmtProbability(o.probability)}</span>
            </label>
          );
        })}
        {outcomes.length === 0 && <div className="future-card__empty">No active outcomes</div>}
      </div>

      <button
        className="future-card__preview-toggle"
        onClick={togglePreview}
        disabled={previewDisabled || busy}
        title={previewTooltip}
        aria-expanded={previewOpen}
      >
        <span className={`future-card__chevron${previewOpen ? " future-card__chevron--open" : ""}`}>
          ▸
        </span>
        {previewOpen ? "Hide markets" : "View markets"}
      </button>

      {previewOpen && (
        <div className="future-card__preview">
          {previewLoading && <div className="future-card__empty">Loading preview…</div>}
          {previewError && (
            <div className="future-card__status future-card__status--err">{previewError}</div>
          )}
          {preview && (
            <div className="fpreview">
              <div className="fpreview__meta">
                <div>
                  <span className="fpreview__label">Title</span>
                  <span className="fpreview__value">{preview.parent_market?.title}</span>
                </div>
                <div>
                  <span className="fpreview__label">Mode</span>
                  <span className="fpreview__value">{preview.mode}</span>
                </div>
                <div>
                  <span className="fpreview__label">CMS POSTs</span>
                  <span className="fpreview__value">{preview.post_count}</span>
                </div>
                <div>
                  <span className="fpreview__label">Canonical name</span>
                  <span className="fpreview__value fpreview__value--mono">
                    {preview.canonical_name}
                  </span>
                </div>
              </div>
              <div className="fpreview__markets">
                {(preview.markets || []).map((m) => (
                  <details key={m.market_code} className="fpreview__market">
                    <summary className="fpreview__market-summary">
                      <span className="fpreview__market-name">{m.name}</span>
                      <code className="fpreview__market-code">{m.market_code}</code>
                    </summary>
                    <div className="fpreview__market-body">
                      <div>
                        <span className="fpreview__label">team_id</span>
                        <code className="fpreview__value fpreview__value--mono">{m.team_id}</code>
                      </div>
                      <div>
                        <span className="fpreview__label">rules</span>
                        <span className="fpreview__rules">{m.rules}</span>
                      </div>
                    </div>
                  </details>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="future-card__actions">
        <button
          className="future-card__btn future-card__btn--primary"
          onClick={handlePublish}
          disabled={!canQuick || busy}
          title={canQuick ? "" : tooltip}
        >
          {busy ? "Publishing…" : "Publish"}
        </button>
        <button
          className="future-card__btn future-card__btn--ghost"
          onClick={() => onConfigure?.(selectedIds)}
          disabled={busy}
        >
          Configure
        </button>
      </div>

      {(blurb || error) && (
        <div
          className={`future-card__status${
            run?.status === "failed" || error ? " future-card__status--err" : ""
          }${run?.status === "completed" ? " future-card__status--ok" : ""}`}
        >
          {error || blurb}
        </div>
      )}
    </div>
  );
}
