import { useEffect, useMemo, useState } from "react";
import MarketComposer from "./MarketComposer.jsx";
import SchedulePanel from "./SchedulePanel.jsx";
import SportRail from "./SportRail.jsx";
import CmsDbReadCard from "./CmsDbReadCard.jsx";
import { fetchLeagues } from "../api.js";

const SPORT_LABEL_FALLBACK = { soccer: "Soccer", nba: "NBA", nfl: "NFL" };
const SPORT_ICON_FALLBACK = { soccer: "⚽", nba: "🏀", nfl: "🏈" };

export default function BuilderView({
  activeEnv,
  submarkets,
  onToggle,
  builderSelectedIds,
  onToggleBuilderFixture,
  onSelectAllBuilderFixtures,
  onClearBuilderFixtures,
  onBuilderPublish,
  publishing,
  publishError,
  publishSuccess,
  activeSport,
  onSportChange,
  perFixtureLineDrafts,
  onFixtureLinesChange,
}) {
  const fixtureCount = builderSelectedIds.size;
  const marketCount = submarkets.size;
  const canPublish = fixtureCount > 0 && marketCount > 0;

  const [leagues, setLeagues] = useState([]);
  const [activeLeague, setActiveLeague] = useState(null);
  const [expandedSports, setExpandedSports] = useState(() => new Set());
  const [loadingLeagues, setLoadingLeagues] = useState(true);

  const envCode = activeEnv?.code ?? null;

  // Fetch leagues on env change; seed activeSport/activeLeague off the first
  // entry so the rail mounts with something selected.
  useEffect(() => {
    setLoadingLeagues(true);
    setLeagues([]);
    setActiveLeague(null);
    fetchLeagues()
      .then((list) => {
        setLeagues(list);
        if (list.length) {
          const firstSport = list[0].sport || "soccer";
          setExpandedSports(new Set([firstSport]));
          // Only fire onSportChange if the parent's activeSport doesn't already
          // match — avoids clobbering a user-selected sport across env switches.
          if (activeSport !== firstSport) onSportChange?.(firstSport);
          const firstLeague = list.find((l) => (l.sport || "soccer") === firstSport) || list[0];
          setActiveLeague(firstLeague.code);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingLeagues(false));
  }, [envCode]);

  // Sport metadata derived from the league list. Each entry carries the
  // label + icon needed by the rail, with local fallbacks if the schedule API
  // didn't include them.
  const sportsList = useMemo(() => {
    const seen = new Map();
    for (const l of leagues) {
      const code = l.sport || "soccer";
      if (seen.has(code)) continue;
      seen.set(code, {
        code,
        label: l.sportLabel || SPORT_LABEL_FALLBACK[code] || code || "Other",
        icon: l.sportIcon || SPORT_ICON_FALLBACK[code] || "",
      });
    }
    return [...seen.values()];
  }, [leagues]);

  const leaguesBySport = useMemo(() => {
    const map = new Map();
    for (const l of leagues) {
      const code = l.sport || "soccer";
      if (!map.has(code)) map.set(code, []);
      map.get(code).push(l);
    }
    return map;
  }, [leagues]);

  function handleSwitchSport(sport) {
    setExpandedSports((prev) => {
      const next = new Set(prev);
      next.add(sport);
      return next;
    });
    if (sport !== activeSport) onSportChange?.(sport);
    const first = leagues.find((l) => (l.sport || "soccer") === sport);
    if (first) setActiveLeague(first.code);
  }

  function handleToggleExpand(sport) {
    setExpandedSports((prev) => {
      const next = new Set(prev);
      if (next.has(sport)) next.delete(sport);
      else next.add(sport);
      return next;
    });
  }

  return (
    <div className="builder">
      <div className="builder__main">
        <SportRail
          sportsList={sportsList}
          leaguesBySport={leaguesBySport}
          activeSport={activeSport}
          activeLeague={activeLeague}
          expandedSports={expandedSports}
          onSwitchSport={handleSwitchSport}
          onToggleExpand={handleToggleExpand}
          onSelectLeague={setActiveLeague}
          loading={loadingLeagues}
        />

        <div className="builder__left">
          <MarketComposer selected={submarkets} onToggle={onToggle} sport={activeSport} />

          {/* Empty-state hint only — once fixtures are picked, the sticky
              .builder__action-bar at the bottom of .builder takes over the CTA. */}
          {fixtureCount === 0 && (
            <div className="builder__publish builder__publish--empty">
              <div className="builder__publish-divider" />
              <div className="builder__publish-summary">
                <span className="builder__publish-hint">
                  {marketCount > 0
                    ? "Now select fixtures on the right →"
                    : "Pick market families above, then select fixtures →"}
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="builder__right">
          <SchedulePanel
            activeEnv={activeEnv}
            activeSport={activeSport}
            activeLeague={activeLeague}
            loadingLeagues={loadingLeagues}
            selectedIds={builderSelectedIds}
            onToggle={onToggleBuilderFixture}
            onSelectAll={onSelectAllBuilderFixtures}
            onClearAll={onClearBuilderFixtures}
            perFixtureLineDrafts={perFixtureLineDrafts}
            onFixtureLinesChange={onFixtureLinesChange}
          />
        </div>
      </div>

      {fixtureCount > 0 && (
        <div
          className={`builder__action-bar${publishing ? " builder__action-bar--busy" : ""}`}
          role="region"
          aria-label="Publish selection"
        >
          <div className="builder__action-summary">
            <strong>{fixtureCount}</strong>&nbsp;fixture{fixtureCount !== 1 ? "s" : ""}
            <span className="builder__action-sep">·</span>
            <strong>{marketCount}</strong>&nbsp;market{marketCount !== 1 ? "s" : ""}
            {marketCount === 0 && (
              <span className="builder__action-hint">— pick at least one market family</span>
            )}
            {publishSuccess && (
              <span className="status-pill status-pill--published">Published</span>
            )}
            {publishError && (
              <span className="builder__action-err" title={publishError}>
                {publishError}
              </span>
            )}
          </div>
          <button
            className="btn-primary builder__action-btn"
            disabled={!canPublish || publishing}
            onClick={onBuilderPublish}
          >
            {publishing ? "Publishing…" : "Publish"}
          </button>
        </div>
      )}

      <div className="builder__bottom">
        <CmsDbReadCard />
      </div>
    </div>
  );
}
