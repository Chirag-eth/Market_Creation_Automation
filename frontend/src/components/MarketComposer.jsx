import { useRef, useEffect } from "react";
import { getSubmarketGroupsForSport } from "../data.js";

function GroupToggle({ groupIds, selected, onToggle }) {
  const allIn = groupIds.every((id) => selected.has(id));
  const someIn = !allIn && groupIds.some((id) => selected.has(id));
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = someIn;
  }, [someIn]);

  function toggle(e) {
    e.stopPropagation();
    if (allIn)
      groupIds.forEach((id) => {
        if (selected.has(id)) onToggle(id);
      });
    else
      groupIds.forEach((id) => {
        if (!selected.has(id)) onToggle(id);
      });
  }

  return (
    <input
      ref={ref}
      type="checkbox"
      className="cb"
      checked={allIn}
      onChange={toggle}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

export default function MarketComposer({ selected, onToggle, sport }) {
  const groups = getSubmarketGroupsForSport(sport);
  return (
    <div className="mcomposer">
      <div className="mcomposer__hdr">
        <span className="mcomposer__title">Market Family</span>
        {selected.size > 0 && <span className="mcomposer__count">{selected.size} selected</span>}
      </div>

      <div className="mcomposer__body">
        {groups.map((group) => {
          // Group toggle only acts on enabled markets — disabled rows are
          // display-only and should not be flipped by a "select group" action.
          const enabledMarkets = group.markets.filter((m) => !m.disabled);
          const enabledIds = enabledMarkets.map((m) => m.id);
          const allDisabled = enabledIds.length === 0;
          return (
            <div key={group.id} className="mcomposer__group">
              <div className="mcomposer__group-hdr">
                {allDisabled ? (
                  <span className="cb cb--placeholder" aria-hidden />
                ) : (
                  <GroupToggle groupIds={enabledIds} selected={selected} onToggle={onToggle} />
                )}
                <span className="mcomposer__group-label">{group.label}</span>
                {allDisabled && (
                  <span
                    className="mcomposer__group-tag"
                    title="Backend rule templates not yet seeded for these markets."
                  >
                    Soon
                  </span>
                )}
              </div>
              {group.markets.map((m) => (
                <label
                  key={m.id}
                  className={`mcomposer__item${m.disabled ? " mcomposer__item--disabled" : ""}`}
                  title={m.disabled ? "Coming soon — rule template not seeded yet" : undefined}
                >
                  <input
                    type="checkbox"
                    className="cb"
                    checked={!m.disabled && selected.has(m.id)}
                    onChange={() => {
                      if (!m.disabled) onToggle(m.id);
                    }}
                    disabled={m.disabled}
                  />
                  <span className="mcomposer__item-label">{m.label}</span>
                  {m.disabled && <span className="mcomposer__item-tag">Soon</span>}
                </label>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
