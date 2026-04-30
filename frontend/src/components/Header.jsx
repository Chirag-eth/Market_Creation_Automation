import { useState, useRef, useEffect } from 'react'

function SunIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4"/>
      <line x1="12" y1="2"  x2="12" y2="4"/>
      <line x1="12" y1="20" x2="12" y2="22"/>
      <line x1="4.22" y1="4.22"   x2="5.64" y2="5.64"/>
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
      <line x1="2"  y1="12" x2="4"  y2="12"/>
      <line x1="20" y1="12" x2="22" y2="12"/>
      <line x1="4.22" y1="19.78"  x2="5.64" y2="18.36"/>
      <line x1="18.36" y1="5.64"  x2="19.78" y2="4.22"/>
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  )
}

function QueueIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <polyline points="12 6 12 12 16 14"/>
    </svg>
  )
}

function UserMenu({ user, onSignOut }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div className="user-menu" ref={ref}>
      <button className="user-menu__trigger" onClick={() => setOpen(o => !o)}>
        <span className="user-menu__avatar">{user.initials}</span>
      </button>

      {open && (
        <div className="user-menu__dropdown">
          <div className="user-menu__info">
            <div className="user-menu__avatar user-menu__avatar--lg">{user.initials}</div>
            <div className="user-menu__details">
              <div className="user-menu__name">{user.name}</div>
              <div className="user-menu__email">{user.email}</div>
            </div>
          </div>
          <div className="user-menu__divider" />
          <button className="user-menu__signout" onClick={() => { setOpen(false); onSignOut() }}>
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}

function EnvSelector({ activeEnv, environments, onSwitch }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const label = activeEnv?.label ?? '…'
  const code  = activeEnv?.code  ?? ''

  return (
    <div className="env-sel" ref={ref}>
      <button
        className={`env-sel__trigger env-sel__trigger--${code}`}
        onClick={() => setOpen(o => !o)}
        title="Switch environment"
      >
        <span className="env-sel__dot" />
        {label}
        <svg className="env-sel__chevron" width="10" height="10" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {open && (
        <div className="env-sel__menu">
          {environments.map(env => (
            <button
              key={env.code}
              className={`env-sel__item${env.code === code ? ' env-sel__item--active' : ''}`}
              onClick={() => { onSwitch(env.code); setOpen(false) }}
            >
              <span className={`env-sel__dot env-sel__dot--${env.code}`} />
              {env.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Header({ theme, onToggleTheme, queueCount, onQueueOpen, user, onSignOut,
  activeEnv, environments, onSwitchEnv }) {
  return (
    <header className="hdr">
      <div className="hdr__logo">
        <div className="hdr__mark">MO</div>
        Market Ops
      </div>
      <div className="hdr__gap" />
      <EnvSelector activeEnv={activeEnv} environments={environments} onSwitch={onSwitchEnv} />

      <button
        className={`hdr__queue${queueCount > 0 ? ' hdr__queue--active' : ''}`}
        onClick={onQueueOpen}
        title="Scheduled queue"
      >
        <QueueIcon />
        {queueCount > 0
          ? <><span className="hdr__queue-label">Queue</span><span className="hdr__queue-badge">{queueCount}</span></>
          : <span className="hdr__queue-label">Queue</span>
        }
      </button>

      <button
        className="hdr__theme"
        onClick={onToggleTheme}
        title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
      </button>

      {user && <UserMenu user={user} onSignOut={onSignOut} />}
    </header>
  )
}
