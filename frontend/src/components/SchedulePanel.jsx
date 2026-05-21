import { useState, useEffect, useRef } from "react";
import { fetchFixtures, checkExistingFixtures } from "../api.js";
import { getPopularLinesForSport } from "../data.js";
import EmptyState from "./EmptyState.jsx";

// Parse a comma-separated lines string into a deduped array of trimmed values.
function parseLinesValue(raw) {
  return Array.from(
    new Set(
      String(raw || "")
        .split(/[,\s]+/)
        .map((v) => v.trim())
        .filter(Boolean)
    )
  );
}

// Split a raw lines string into valid (numeric, e.g. "216.5") vs invalid tokens.
// Allows up to one decimal point; rejects "abc", "1.2.3", trailing commas, etc.
// Returned arrays are still order-preserving so the UI can surface what was
// typed (not the deduped/sorted view).
const LINE_NUMBER_RE = /^[0-9]+(\.[0-9]+)?$/;
function partitionLinesValue(raw) {
  const tokens = String(raw || "")
    .split(/[,\s]+/)
    .map((v) => v.trim())
    .filter(Boolean);
  const valid = [];
  const invalid = [];
  for (const t of tokens) {
    if (LINE_NUMBER_RE.test(t)) valid.push(t);
    else invalid.push(t);
  }
  return { valid, invalid };
}

function joinLinesValue(values) {
  return values.join(", ");
}

// Toggle a preset value in/out of a comma-separated lines string. Returns the
// new string. If the value is present, it's removed; otherwise appended.
function toggleLineInValue(raw, value) {
  const current = parseLinesValue(raw);
  const idx = current.indexOf(value);
  if (idx === -1) current.push(value);
  else current.splice(idx, 1);
  return joinLinesValue(current);
}

function fmtKickoff(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return (
    d.toLocaleDateString("en-GB", { month: "short", day: "numeric" }) +
    " · " +
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }) +
    " UTC"
  );
}

function SelectAllCheckbox({ fixtures, selectedIds, onSelectAll, onClearAll }) {
  const ref = useRef(null);
  const total = fixtures.length;
  const selCount = fixtures.filter((f) =>
    selectedIds.has(f.providerFixtureId || f.fixture_id)
  ).length;
  const allIn = total > 0 && selCount === total;
  const someIn = selCount > 0 && selCount < total;

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = someIn;
  }, [someIn]);

  function handleChange() {
    if (allIn || someIn) onClearAll();
    else onSelectAll(fixtures);
  }

  return (
    <div className="fix-select-bar">
      <input
        ref={ref}
        type="checkbox"
        className="cb"
        checked={allIn}
        onChange={handleChange}
        disabled={total === 0}
      />
      <span className="fix-select-bar__label">Select all</span>
      {selCount > 0 && <span className="fix-select-bar__count">{selCount} selected</span>}
    </div>
  );
}

const CUSTOM_LINE_SPORTS = new Set(["nba", "nfl"]);

export default function SchedulePanel({
  activeEnv,
  activeSport,
  activeLeague,
  loadingLeagues,
  selectedIds,
  onToggle,
  onSelectAll,
  onClearAll,
  perFixtureLineDrafts,
  onFixtureLinesChange,
}) {
  const [fixtures, setFixtures] = useState([]);
  const [loadingFix, setLoadingFix] = useState(false);
  const [error, setError] = useState(null);
  // Set<game_id> of fixtures already published in the active env's CMS.
  // Refetched whenever env or fixtures change.
  const [existingIds, setExistingIds] = useState(new Set());
  // Map<gid, "published" | "partial"> — surfaced via .status-pill on each row.
  const [statusByGid, setStatusByGid] = useState(new Map());
  const [existingOpen, setExistingOpen] = useState(false);

  const envCode = activeEnv?.code ?? null;

  useEffect(() => {
    if (!activeLeague) return;
    setLoadingFix(true);
    setFixtures([]);
    setExistingIds(new Set());
    setError(null);
    fetchFixtures(activeLeague)
      .then((payload) => setFixtures(Array.isArray(payload.fixtures) ? payload.fixtures : []))
      .catch((e) => setError(e.message))
      .finally(() => setLoadingFix(false));
  }, [activeLeague]);

  // Probe CMS for which fixtures are already published. Non-blocking — if the
  // request fails or DB isn't configured, the UI shows everything as upcoming.
  useEffect(() => {
    if (!envCode || !activeLeague || fixtures.length === 0) {
      setExistingIds(new Set());
      setStatusByGid(new Map());
      return;
    }
    let cancelled = false;
    const probeFixtures = fixtures
      .map((f) => ({
        game_id: f.gameId || f.game_id || f.providerFixtureId || "",
        home: f.homeTeamName || "",
        away: f.awayTeamName || "",
        leagueCode: activeLeague,
        kickoff: f.kickoffIso || `${f.fixtureDate}T${f.kickoffTimeUtc}:00Z`,
      }))
      .filter((p) => p.game_id);
    if (probeFixtures.length === 0) return;
    checkExistingFixtures({ environment: envCode, fixtures: probeFixtures })
      .then((data) => {
        if (cancelled) return;
        const ids = new Set((data?.existing_game_ids || []).map(String));
        setExistingIds(ids);
        // by_game_id is keyed by gid; entries with partial:true have *some*
        // markets but not the full standard set. The rest of by_game_id are
        // fully-published (already in existing_game_ids).
        const status = new Map();
        const byGid = data?.by_game_id || {};
        for (const [gid, info] of Object.entries(byGid)) {
          if (info?.partial) status.set(String(gid), "partial");
          else if (ids.has(String(gid))) status.set(String(gid), "published");
        }
        setStatusByGid(status);
      })
      .catch(() => {
        // Silent — Builder remains usable even if the check fails.
      });
    return () => {
      cancelled = true;
    };
  }, [envCode, activeLeague, fixtures]);

  function enrichFixture(f) {
    const id = f.providerFixtureId || f.fixture_id;
    const kickoff = f.kickoffIso || `${f.fixtureDate}T${f.kickoffTimeUtc}:00Z`;
    return { ...f, id, kickoff, leagueCode: activeLeague, sport: activeSport || "soccer" };
  }

  function handleToggle(f) {
    onToggle(enrichFixture(f));
  }

  function handleSelectAll(allFixtures) {
    onSelectAll(allFixtures.map(enrichFixture));
  }

  function handleClearAll() {
    onClearAll();
  }

  const selCount = selectedIds.size;

  // Partition fixtures: existing match by game_id (sportsdata) or
  // providerFixtureId. Selection lives only on the upcoming side.
  const upcoming = [];
  const existing = [];
  for (const f of fixtures) {
    const gid = String(f.gameId || f.game_id || f.providerFixtureId || "");
    if (gid && existingIds.has(gid)) existing.push(f);
    else upcoming.push(f);
  }

  return (
    <div className="spanel-right">
      <div className="spanel-right__hdr">
        <span className="spanel-right__title">Schedule</span>
        {loadingLeagues && <span className="spanel-right__hint">Loading leagues…</span>}
        {selCount > 0 && !loadingLeagues && (
          <span className="spanel-right__sel">
            {selCount} fixture{selCount !== 1 ? "s" : ""} selected
          </span>
        )}
      </div>

      {!loadingFix && !error && upcoming.length > 0 && (
        <SelectAllCheckbox
          fixtures={upcoming}
          selectedIds={selectedIds}
          onSelectAll={handleSelectAll}
          onClearAll={handleClearAll}
        />
      )}

      <div className="spanel-right__fixtures">
        {loadingFix && (
          <EmptyState
            tone="loading"
            title="Loading fixtures…"
            hint="Pulling the upcoming schedule for this league."
          />
        )}
        {error && <EmptyState tone="error" icon="!" title="Couldn't load fixtures" hint={error} />}
        {!loadingFix && !error && fixtures.length === 0 && (
          <EmptyState
            icon="∅"
            title="No upcoming fixtures"
            hint="Try another league, or come back closer to matchday."
          />
        )}
        {!loadingFix && !error && upcoming.length === 0 && existing.length > 0 && (
          <EmptyState
            icon="✓"
            title="All caught up"
            hint="Every fixture in this league is already published in this environment."
          />
        )}
        {upcoming.map((f) => {
          const id = f.providerFixtureId || f.fixture_id;
          const gid = String(f.gameId || f.game_id || f.providerFixtureId || "");
          const rowStatus = gid ? statusByGid.get(gid) : null;
          const isActive = selectedIds.has(id);
          const kickoff = f.kickoffIso || `${f.fixtureDate}T${f.kickoffTimeUtc}:00Z`;
          const showLineInputs =
            isActive && CUSTOM_LINE_SPORTS.has(String(activeSport || "").toLowerCase());
          const drafts = (perFixtureLineDrafts && perFixtureLineDrafts[id]) || {};
          const popularLines = showLineInputs ? getPopularLinesForSport(activeSport) : null;
          const totalsSet = new Set(parseLinesValue(drafts.totals));
          const spreadsSet = new Set(parseLinesValue(drafts.spreads));
          const totalsParts = showLineInputs ? partitionLinesValue(drafts.totals) : null;
          const spreadsParts = showLineInputs ? partitionLinesValue(drafts.spreads) : null;
          return (
            <div
              key={id}
              className={`fix-row${isActive ? " fix-row--active" : ""}${rowStatus === "partial" ? " fix-row--partial" : ""}`}
              onClick={() => handleToggle(f)}
              title={
                rowStatus === "partial"
                  ? "Some markets already exist for this fixture — publishing will fill in the missing ones."
                  : undefined
              }
            >
              <input
                type="checkbox"
                className="cb fix-row__cb"
                checked={isActive}
                onChange={() => handleToggle(f)}
                onClick={(e) => e.stopPropagation()}
              />
              <div className="fix-row__content">
                <div className="fix-row__match">
                  {f.homeTeamName} <span className="fix-row__vs">vs</span> {f.awayTeamName}
                </div>
                <div className="fix-row__meta">
                  {fmtKickoff(kickoff)}
                  {rowStatus === "partial" && (
                    <span className="status-pill status-pill--partial">Partial</span>
                  )}
                </div>
                {showLineInputs && (
                  <div className="fix-row__lines" onClick={(e) => e.stopPropagation()}>
                    <div className="fix-row__line-block">
                      <label className="fix-row__line">
                        <span className="fix-row__line-label">Totals</span>
                        <input
                          type="text"
                          className={`fix-row__line-input${
                            totalsParts && totalsParts.invalid.length > 0
                              ? " fix-row__line-input--invalid"
                              : ""
                          }`}
                          placeholder="e.g. 216.5, 220.5"
                          value={drafts.totals || ""}
                          onChange={(e) =>
                            onFixtureLinesChange &&
                            onFixtureLinesChange(id, "totals", e.target.value)
                          }
                          aria-invalid={
                            totalsParts && totalsParts.invalid.length > 0 ? "true" : undefined
                          }
                        />
                      </label>
                      {totalsParts &&
                        (totalsParts.valid.length > 0 || totalsParts.invalid.length > 0) && (
                          <div
                            className={`fix-row__line-caption${
                              totalsParts.invalid.length > 0 ? " fix-row__line-caption--err" : ""
                            }`}
                          >
                            {totalsParts.invalid.length > 0
                              ? `${totalsParts.invalid.length} invalid: ${totalsParts.invalid
                                  .slice(0, 3)
                                  .join(", ")}${totalsParts.invalid.length > 3 ? "…" : ""}`
                              : `${totalsParts.valid.length} line${
                                  totalsParts.valid.length === 1 ? "" : "s"
                                } ready`}
                          </div>
                        )}
                      {popularLines && popularLines.totals.length > 0 && (
                        <div className="fix-row__chips">
                          {popularLines.totals.map((line) => {
                            const selected = totalsSet.has(line);
                            return (
                              <button
                                key={line}
                                type="button"
                                className={`fix-row__chip${selected ? " fix-row__chip--on" : ""}`}
                                onClick={() =>
                                  onFixtureLinesChange &&
                                  onFixtureLinesChange(
                                    id,
                                    "totals",
                                    toggleLineInValue(drafts.totals, line)
                                  )
                                }
                              >
                                {line}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <div className="fix-row__line-block">
                      <label className="fix-row__line">
                        <span className="fix-row__line-label">Spreads</span>
                        <input
                          type="text"
                          className={`fix-row__line-input${
                            spreadsParts && spreadsParts.invalid.length > 0
                              ? " fix-row__line-input--invalid"
                              : ""
                          }`}
                          placeholder="e.g. 11.5, 7.5"
                          value={drafts.spreads || ""}
                          onChange={(e) =>
                            onFixtureLinesChange &&
                            onFixtureLinesChange(id, "spreads", e.target.value)
                          }
                          aria-invalid={
                            spreadsParts && spreadsParts.invalid.length > 0 ? "true" : undefined
                          }
                        />
                      </label>
                      {spreadsParts &&
                        (spreadsParts.valid.length > 0 || spreadsParts.invalid.length > 0) && (
                          <div
                            className={`fix-row__line-caption${
                              spreadsParts.invalid.length > 0 ? " fix-row__line-caption--err" : ""
                            }`}
                          >
                            {spreadsParts.invalid.length > 0
                              ? `${spreadsParts.invalid.length} invalid: ${spreadsParts.invalid
                                  .slice(0, 3)
                                  .join(", ")}${spreadsParts.invalid.length > 3 ? "…" : ""}`
                              : `${spreadsParts.valid.length} line${
                                  spreadsParts.valid.length === 1 ? "" : "s"
                                } ready`}
                          </div>
                        )}
                      {popularLines && popularLines.spreads.length > 0 && (
                        <div className="fix-row__chips">
                          {popularLines.spreads.map((line) => {
                            const selected = spreadsSet.has(line);
                            return (
                              <button
                                key={line}
                                type="button"
                                className={`fix-row__chip${selected ? " fix-row__chip--on" : ""}`}
                                onClick={() =>
                                  onFixtureLinesChange &&
                                  onFixtureLinesChange(
                                    id,
                                    "spreads",
                                    toggleLineInValue(drafts.spreads, line)
                                  )
                                }
                              >
                                -{line}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {existing.length > 0 && (
          <div className="fix-existing">
            <button
              type="button"
              className="fix-existing__toggle"
              onClick={() => setExistingOpen((v) => !v)}
              aria-expanded={existingOpen}
            >
              <span
                className={`fix-existing__chevron${existingOpen ? " fix-existing__chevron--open" : ""}`}
              >
                ▸
              </span>
              <span className="fix-existing__label">Existing</span>
              <span className="fix-existing__count">{existing.length}</span>
            </button>
            {existingOpen &&
              existing.map((f) => {
                const id = f.providerFixtureId || f.fixture_id;
                const kickoff = f.kickoffIso || `${f.fixtureDate}T${f.kickoffTimeUtc}:00Z`;
                return (
                  <div
                    key={id}
                    className="fix-row fix-row--existing"
                    title="Already published in this environment"
                  >
                    <input
                      type="checkbox"
                      className="cb fix-row__cb"
                      checked={false}
                      disabled
                      readOnly
                    />
                    <div className="fix-row__content">
                      <div className="fix-row__match">
                        {f.homeTeamName} <span className="fix-row__vs">vs</span> {f.awayTeamName}
                      </div>
                      <div className="fix-row__meta">
                        {fmtKickoff(kickoff)}
                        <span className="status-pill status-pill--published">Published</span>
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </div>
    </div>
  );
}
