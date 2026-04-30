import { useRef, useEffect } from 'react'
import { submarketGroups, ALL_SUBMARKET_IDS } from '../data.js'

const PRESETS = [
  { id: 'all',      label: 'All',         ids: ALL_SUBMARKET_IDS },
  { id: 'standard', label: 'Standard',    ids: ['moneyline', 'spreads', 'ou_2_5', 'btts'] },
  { id: 'result',   label: 'Result only', ids: ['moneyline'] },
]

function GroupIndeterminate({ groupIds, selected }) {
  const allIn  = groupIds.every(id => selected.has(id))
  const someIn = !allIn && groupIds.some(id => selected.has(id))
  const ref    = useRef(null)
  useEffect(() => { if (ref.current) ref.current.indeterminate = someIn }, [someIn])
  return (
    <input
      ref={ref}
      type="checkbox"
      className="cb"
      checked={allIn}
      onChange={() => {}}
      onClick={e => e.stopPropagation()}
    />
  )
}

export default function SubmarketPanel({
  open, fixtureCount, selected,
  onToggle, onSelectAll, onClear, onSetSubmarkets,
}) {
  const allSelected = ALL_SUBMARKET_IDS.every(id => selected.has(id))

  return (
    <div className={`spanel${open ? ' spanel--open' : ''}`}>
      <div className="spanel__hdr">
        <div className="spanel__title">Submarkets</div>
        <div className="spanel__sub">
          Apply to {fixtureCount} fixture{fixtureCount !== 1 ? 's' : ''}
          {selected.size > 0 && ` · ${selected.size} selected`}
        </div>

        {/* Presets */}
        <div className="spanel__presets">
          {PRESETS.map(p => {
            const active = p.ids.length === selected.size && p.ids.every(id => selected.has(id))
            return (
              <button
                key={p.id}
                className={`preset-btn${active ? ' preset-btn--active' : ''}`}
                onClick={() => onSetSubmarkets(new Set(p.ids))}
              >
                {p.label}
              </button>
            )
          })}
        </div>

        <div className="spanel__btns">
          <button className="btn-ghost" onClick={onSelectAll} disabled={allSelected}>Select all</button>
          <button className="btn-ghost" onClick={onClear} disabled={selected.size === 0}>Clear</button>
        </div>
      </div>

      <div className="spanel__body">
        {submarketGroups.map(group => {
          const groupIds = group.markets.map(m => m.id)
          const allIn    = groupIds.every(id => selected.has(id))

          function toggleGroup(e) {
            e.stopPropagation()
            if (allIn) groupIds.forEach(id => { if (selected.has(id)) onToggle(id) })
            else       groupIds.forEach(id => { if (!selected.has(id)) onToggle(id) })
          }

          return (
            <div key={group.id} className="sgroup">
              <div className="sgroup__hdr" onClick={toggleGroup}>
                <GroupIndeterminate groupIds={groupIds} selected={selected} />
                <span className="sgroup__label">{group.label}</span>
              </div>
              {group.markets.map(m => (
                <div key={m.id} className="sitem" onClick={() => onToggle(m.id)}>
                  <input
                    type="checkbox"
                    className="cb"
                    checked={selected.has(m.id)}
                    onChange={() => onToggle(m.id)}
                    onClick={e => e.stopPropagation()}
                  />
                  <span className="sitem__label">{m.label}</span>
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
