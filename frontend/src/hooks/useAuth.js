import { useState, useEffect } from 'react'

export function useAuth() {
  const [user,          setUser]          = useState(null)
  const [loading,       setLoading]       = useState(true)
  const [loadingGoogle, setLoadingGoogle] = useState(false)
  const [loadingEmail,  setLoadingEmail]  = useState(false)
  const [linkSentTo,    setLinkSentTo]    = useState(null)
  const [error,         setError]         = useState(null)

  // Restore session on mount by checking the httpOnly cookie via /auth/me
  useEffect(() => {
    fetch('/auth/me')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.email) setUser(data) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function signInWithGoogle() {
    setLoadingGoogle(true)
    setError(null)
    window.location.href = '/auth/google'
  }

  async function signOut() {
    try { await fetch('/auth/logout') } catch {}
    setUser(null)
    window.location.reload()
  }

  async function sendMagicLink(email) {
    setLoadingEmail(true)
    setError(null)
    await new Promise(r => setTimeout(r, 300))
    setError('Magic link sign-in is not yet available.')
    setLoadingEmail(false)
  }

  async function resendMagicLink() {}

  function resetLinkFlow() {
    setLinkSentTo(null)
    setError(null)
  }

  return {
    user, loading, error,
    loadingGoogle, loadingEmail,
    linkSentTo,
    signInWithGoogle, sendMagicLink, resendMagicLink, resetLinkFlow,
    signOut,
  }
}
