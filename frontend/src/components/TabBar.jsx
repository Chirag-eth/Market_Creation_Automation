export default function TabBar({ tab, onChange }) {
  const tabs = [
    { id: 'builder',  label: 'Builder' },
    { id: 'fixtures', label: 'Upcoming Fixtures' },
    { id: 'json',     label: 'JSON' },
  ]
  return (
    <nav className="tabbar">
      {tabs.map(t => (
        <button
          key={t.id}
          className={`tabbar__btn${tab === t.id ? ' tabbar__btn--active' : ''}`}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </nav>
  )
}
