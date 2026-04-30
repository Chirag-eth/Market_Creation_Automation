import { useState } from 'react'

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  )
}

function Spinner({ color }) {
  return (
    <svg className="login__spinner" width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke={color || 'currentColor'} strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
      <path d="M12 2a10 10 0 0 1 10 10"/>
    </svg>
  )
}

function MailIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="4" width="20" height="16" rx="2"/>
      <path d="m2 7 10 7 10-7"/>
    </svg>
  )
}

// ── Magic link sent screen ────────────────────────────────────────────
function CheckInboxView({ email, loading, onResend, onBack }) {
  const [resent,   setResent]   = useState(false)
  const [cooldown, setCooldown] = useState(0)

  async function handleResend() {
    await onResend()
    setResent(true)
    setCooldown(30)
    const t = setInterval(() => {
      setCooldown(n => {
        if (n <= 1) { clearInterval(t); setResent(false); return 0 }
        return n - 1
      })
    }, 1000)
  }

  const isGmail = email.endsWith('@gmail.com') || email.endsWith('@googlemail.com')

  return (
    <div className="login__inbox-view">
      <div className="login__inbox-icon">
        <MailIcon />
      </div>
      <h2 className="login__inbox-title">Check your inbox</h2>
      <p className="login__inbox-sub">
        We sent a sign-in link to<br />
        <strong className="login__inbox-email">{email}</strong>
      </p>

      <p className="login__inbox-hint">
        The link expires in 10 minutes. If you don't see it, check your spam folder.
      </p>

      <div className="login__inbox-actions">
        {isGmail && (
          <a
            className="login__google-btn login__google-btn--outline"
            href="https://mail.google.com"
            target="_blank"
            rel="noreferrer"
          >
            <GoogleIcon />
            Open Gmail
          </a>
        )}

        <button
          className="login__resend-btn"
          onClick={handleResend}
          disabled={loading || cooldown > 0}
        >
          {loading
            ? <><Spinner />&nbsp;Sending…</>
            : resent
              ? '✓ Sent!'
              : cooldown > 0
                ? `Resend in ${cooldown}s`
                : 'Resend link'
          }
        </button>
      </div>

      <button className="login__back-link" onClick={onBack}>
        ← Use a different email
      </button>

      <p className="login__inbox-demo-note">
        <em>Demo: auto-signing in after 3 s…</em>
      </p>
    </div>
  )
}

// ── Main sign-in screen ───────────────────────────────────────────────
function SignInView({ onGoogle, onMagicLink, loadingGoogle, loadingEmail, error }) {
  const [email,     setEmail]     = useState('')
  const [emailErr,  setEmailErr]  = useState('')

  function validateEmail(v) {
    if (!v)               return 'Email is required'
    if (!/\S+@\S+\.\S+/.test(v)) return 'Enter a valid email address'
    return ''
  }

  function handleSubmit(e) {
    e.preventDefault()
    const err = validateEmail(email)
    if (err) { setEmailErr(err); return }
    setEmailErr('')
    onMagicLink(email)
  }

  const anyLoading = loadingGoogle || loadingEmail

  return (
    <>
      <div className="login__hd">
        <h1 className="login__title">Welcome back</h1>
        <p className="login__sub">Sign in to continue to Market Ops</p>
      </div>

      {/* Google SSO — primary CTA */}
      <button
        className="login__google-btn"
        onClick={onGoogle}
        disabled={anyLoading}
        aria-busy={loadingGoogle}
      >
        <span className="login__btn-icon">
          {loadingGoogle ? <Spinner color="#4285F4" /> : <GoogleIcon />}
        </span>
        <span>{loadingGoogle ? 'Signing in…' : 'Continue with Google'}</span>
      </button>

      <div className="login__divider">
        <span className="login__divider-line" />
        <span className="login__divider-text">or sign in with email</span>
        <span className="login__divider-line" />
      </div>

      {/* Magic link form */}
      <form className="login__form" onSubmit={handleSubmit} noValidate>
        <div className={`login__field${emailErr ? ' login__field--error' : ''}`}>
          <label className="login__label" htmlFor="login-email">Email address</label>
          <input
            id="login-email"
            className="login__input"
            type="email"
            placeholder="you@polymarket.com"
            value={email}
            onChange={e => { setEmail(e.target.value); if (emailErr) setEmailErr('') }}
            onBlur={() => setEmailErr(validateEmail(email))}
            autoComplete="email"
            inputMode="email"
            disabled={anyLoading}
          />
          {emailErr && <span className="login__field-err">{emailErr}</span>}
        </div>

        <button
          type="submit"
          className="login__magic-btn"
          disabled={anyLoading}
          aria-busy={loadingEmail}
        >
          {loadingEmail
            ? <><Spinner />&nbsp;Sending link…</>
            : <>Send magic link <span className="login__arrow">→</span></>
          }
        </button>
      </form>

      {error && <div className="login__error" role="alert">{error}</div>}
    </>
  )
}

// ── Root ──────────────────────────────────────────────────────────────
export default function LoginPage({
  onSignInGoogle, onSendMagicLink, onResendMagicLink, onResetLinkFlow,
  loadingGoogle, loadingEmail, error, linkSentTo,
}) {
  return (
    <div className="login">
      <div className="login__card">

        <div className="login__brand">
          <div className="login__mark">MO</div>
          <span className="login__brand-name">Market Ops</span>
          <span className="login__env-tag">Testnet</span>
        </div>

        {linkSentTo
          ? <CheckInboxView
              email={linkSentTo}
              loading={loadingEmail}
              onResend={onResendMagicLink}
              onBack={onResetLinkFlow}
            />
          : <SignInView
              onGoogle={onSignInGoogle}
              onMagicLink={onSendMagicLink}
              loadingGoogle={loadingGoogle}
              loadingEmail={loadingEmail}
              error={error}
            />
        }

        <div className="login__footer">
          <span className="login__footer-dot" />
          Restricted access · Polymarket internal
        </div>

      </div>
    </div>
  )
}
