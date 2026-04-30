export default function SelectionBar({ visible, fixtureCount, submarketCount, totalMarkets, onClear, onReview }) {
  const canReview = fixtureCount > 0 && submarketCount > 0

  return (
    <div className={`selbar${visible ? ' selbar--vis' : ''}`}>
      <div className="selbar__stat">
        <span className="selbar__val">{fixtureCount}</span>
        fixture{fixtureCount !== 1 ? 's' : ''}
      </div>

      <div className="selbar__dot" />

      {submarketCount > 0 ? (
        <div className="selbar__stat">
          <span className="selbar__val">{submarketCount}</span>
          submarket{submarketCount !== 1 ? 's' : ''}
        </div>
      ) : (
        <div className="selbar__hint">Select submarkets &rarr;</div>
      )}

      <div className="selbar__gap" />

      {canReview && (
        <div className="selbar__total">
          {totalMarkets} market{totalMarkets !== 1 ? 's' : ''} total
        </div>
      )}

      <button className="selbar__clear" onClick={onClear}>
        Clear selection
      </button>

      <button
        className="btn-primary"
        onClick={onReview}
        disabled={!canReview}
      >
        Review
        <span className="btn-primary__arrow">→</span>
      </button>
    </div>
  )
}
