import { useState } from 'react'

const STORAGE_KEY = 'mo-auth'

function getStoredUser() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) } catch { return null }
}

function mockUser(email) {
  const name = email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  const initials = name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()
  return { name, email, initials, provider: 'google' }
}

export function useAuth() {
  const [user,          setUser]          = useState(getStoredUser)
  const [loadingGoogle, setLoadingGoogle] = useState(false)
  const [loadingEmail,  setLoadingEmail]  = useState(false)
  const [linkSentTo,    setLinkSentTo]    = useState(null)   // email address magic link was sent to
  const [error,         setError]         = useState(null)

  function persist(u) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(u))
    setUser(u)
  }

  async function signInWithGoogle() {
    setLoadingGoogle(true)
    setError(null)
    try {
      await new Promise(r => setTimeout(r, 1300))
      persist(mockUser('chirag@polymarket.com'))
    } catch {
      setError('Google sign-in failed. Please try again.')
    } finally {
      setLoadingGoogle(false)
    }
  }

  async function sendMagicLink(email) {
    setLoadingEmail(true)
    setError(null)
    try {
      await new Promise(r => setTimeout(r, 1000))
      setLinkSentTo(email)
      // Simulate user clicking the link in their inbox after 3 s
      setTimeout(() => persist(mockUser(email)), 3000)
    } catch {
      setError('Could not send link. Please try again.')
    } finally {
      setLoadingEmail(false)
    }
  }

  async function resendMagicLink() {
    if (!linkSentTo) return
    setLoadingEmail(true)
    await new Promise(r => setTimeout(r, 800))
    setLoadingEmail(false)
  }

  function resetLinkFlow() {
    setLinkSentTo(null)
    setError(null)
  }

  function signOut() {
    localStorage.removeItem(STORAGE_KEY)
    setUser(null)
    setLinkSentTo(null)
  }

  return {
    user, error,
    loadingGoogle, loadingEmail,
    linkSentTo,
    signInWithGoogle, sendMagicLink, resendMagicLink, resetLinkFlow,
    signOut,
  }
}
