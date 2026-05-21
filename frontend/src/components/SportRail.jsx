// Vertical "Top Sports" navigation rail. Owns no state — receives everything
// from BuilderView. Lives in a fixed left column inside .builder__main.

import EmptyState from "./EmptyState.jsx";

export default function SportRail({
  sportsList,
  leaguesBySport,
  activeSport,
  activeLeague,
  expandedSports,
  onSwitchSport,
  onToggleExpand,
  onSelectLeague,
  loading,
}) {
  if (loading) {
    return (
      <aside className="builder__rail">
        <div className="sport-rail">
          <div className="sport-rail__header">Top Sports</div>
          <EmptyState tone="loading" size="sm" title="Loading sports…" />
        </div>
      </aside>
    );
  }

  if (!sportsList || sportsList.length === 0) {
    return (
      <aside className="builder__rail">
        <div className="sport-rail">
          <div className="sport-rail__header">Top Sports</div>
          <EmptyState
            size="sm"
            icon="∅"
            title="No sports"
            hint="The catalog returned an empty list."
          />
        </div>
      </aside>
    );
  }

  return (
    <aside className="builder__rail">
      <div className="sport-rail">
        <div className="sport-rail__header">Top Sports</div>
        {sportsList.map((sport) => {
          const isActive = activeSport === sport.code;
          const isOpen = expandedSports.has(sport.code);
          const sportLeagues = leaguesBySport.get(sport.code) || [];
          const singleLeagueMirror =
            sportLeagues.length === 1 &&
            String(sportLeagues[0].code).toLowerCase() === String(sport.code).toLowerCase();
          return (
            <div key={sport.code} className="sport-rail__group">
              <button
                type="button"
                className={`sport-rail__item${isActive ? " sport-rail__item--active" : ""}`}
                onClick={() => onSwitchSport(sport.code)}
                aria-expanded={isOpen}
              >
                <span className="sport-rail__icon" aria-hidden>
                  {sport.icon || "•"}
                </span>
                <span className="sport-rail__label">{sport.label}</span>
                {sportLeagues.length > 1 && (
                  <span className="sport-rail__count" aria-hidden>
                    {sportLeagues.length}
                  </span>
                )}
                {!singleLeagueMirror && (
                  <span
                    className={`sport-rail__chevron${isOpen ? " sport-rail__chevron--open" : ""}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleExpand(sport.code);
                    }}
                    role="button"
                    aria-label={isOpen ? "Collapse" : "Expand"}
                  >
                    ▸
                  </span>
                )}
              </button>
              {isOpen && !singleLeagueMirror && sportLeagues.length > 0 && (
                <div className="sport-rail__leagues league-tabs">
                  {sportLeagues.map((l) => (
                    <button
                      key={l.code}
                      className={`league-tab${activeLeague === l.code ? " league-tab--active" : ""}`}
                      onClick={() => {
                        if (!isActive) onSwitchSport(sport.code);
                        onSelectLeague(l.code);
                      }}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
