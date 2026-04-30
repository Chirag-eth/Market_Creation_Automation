import MarketComposer from './MarketComposer.jsx'
import SchedulePanel  from './SchedulePanel.jsx'
import CmsDbReadCard  from './CmsDbReadCard.jsx'

export default function BuilderView({
  activeEnv,
  submarkets, onToggle,
  builderSelectedIds,
  onToggleBuilderFixture,
  onSelectAllBuilderFixtures,
  onClearBuilderFixtures,
  onBuilderPublish,
  publishing,
  publishError,
  publishSuccess,
}) {
  const fixtureCount = builderSelectedIds.size
  const marketCount  = submarkets.size
  const canPublish   = fixtureCount > 0 && marketCount > 0

  return (
    <div className="builder">
      <div className="builder__main">
        <div className="builder__left">
          <MarketComposer selected={submarkets} onToggle={onToggle} />

          <div className="builder__publish">
            <div className="builder__publish-divider" />
            <div className="builder__publish-summary">
              {fixtureCount > 0
                ? <><strong>{fixtureCount}</strong> fixture{fixtureCount !== 1 ? 's' : ''} &middot; <strong>{marketCount}</strong> market{marketCount !== 1 ? 's' : ''}</>
                : <span className="builder__publish-hint">Select fixtures on the right</span>
              }
            </div>
            {publishSuccess && (
              <div className="builder__publish-ok">Published successfully</div>
            )}
            {publishError && (
              <div className="builder__publish-err">{publishError}</div>
            )}
            <button
              className="btn-primary builder__publish-btn"
              disabled={!canPublish || publishing}
              onClick={onBuilderPublish}
            >
              {publishing ? 'Publishing…' : 'Publish'}
            </button>
          </div>
        </div>

        <div className="builder__right">
          <SchedulePanel
            activeEnv={activeEnv}
            selectedIds={builderSelectedIds}
            onToggle={onToggleBuilderFixture}
            onSelectAll={onSelectAllBuilderFixtures}
            onClearAll={onClearBuilderFixtures}
          />
        </div>
      </div>

      <div className="builder__bottom">
        <CmsDbReadCard />
      </div>
    </div>
  )
}
