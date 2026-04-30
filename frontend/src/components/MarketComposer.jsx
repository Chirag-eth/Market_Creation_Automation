import { useRef, useEffect } from 'react'
import { submarketGroups } from '../data.js'

function GroupToggle({ groupIds, selected, onToggle }) {
  const allIn  = groupIds.every(id => selected.has(id))
  const someIn = !allIn && groupIds.some(id => selected.has(id))
  const ref    = useRef(null)
  useEffect(() => { if (ref.current) ref.current.indeterminate = someIn }, [someIn])

  function toggle(e) {
    e.stopPropagation()
    if (allIn) groupIds.forEach(id => { if (selected.has(id))  onToggle(id) })
    else       groupIds.forEach(id => { if (!selected.has(id)) onToggle(id) })
  }

  return (
    <input
      ref={ref}
      type="checkbox"
      className="cb"
      checked={allIn}
      onChange={toggle}
      onClick={e => e.stopPropagation()}
    />
  )
}

export default function MarketComposer({ selected, onToggle }) {
  return (
    <div className="mcomposer">
      <div className="mcomposer__hdr">
        <span className="mcomposer__title">Market Family</span>
        {selected.size > 0 && (
          <span className="mcomposer__count">{selected.size} selected</span>
        )}
      </div>

      <div className="mcomposer__body">
        {submarketGroups.map(group => {
          const groupIds = group.markets.map(m => m.id)
          return (
            <div key={group.id} className="mcomposer__group">
              <div className="mcomposer__group-hdr">
                <GroupToggle groupIds={groupIds} selected={selected} onToggle={onToggle} />
                <span className="mcomposer__group-label">{group.label}</span>
              </div>
              {group.markets.map(m => (
                <label key={m.id} className="mcomposer__item">
                  <input
                    type="checkbox"
                    className="cb"
                    checked={selected.has(m.id)}
                    onChange={() => onToggle(m.id)}
                  />
                  <span className="mcomposer__item-label">{m.label}</span>
                </label>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
