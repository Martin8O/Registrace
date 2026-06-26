'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'

// Standalone "set your password" page — the landing target for the Supabase
// invite + password-reset emails (modules/users → redirectTo). NOT inside the
// (panel) shell (no sidebar), like the login page.
//
// Flow: the invite/recovery link carries a token that Supabase's verify endpoint
// turns into a session, handed back in the URL. The browser client's
// detectSessionInUrl consumes it on mount and fires onAuthStateChange; once a
// session exists we let the user choose a password via updateUser({ password }).
// The edge (proxy.ts) lets this route through without a prior server session,
// because the token lives in the URL fragment the server never sees.
export default function SetPasswordPage() {
  const router = useRouter()
  const locale = useLocale()
  const t = useTranslations('admin.setPassword')

  const clientRef = useRef<ReturnType<typeof createClient> | null>(null)
  const [phase, setPhase] = useState<'checking' | 'ready' | 'nosession'>('checking')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    clientRef.current = supabase
    let settled = false
    const markReady = () => {
      if (!settled) {
        settled = true
        setPhase('ready')
      }
    }

    // Two paths to a session: the auth-state event detectSessionInUrl fires, and
    // a direct getSession() (covers the case where it resolved before we subscribed).
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) markReady()
    })
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) markReady()
    })

    // No session after a grace period → the link was invalid/expired or the page
    // was opened directly.
    const timer = setTimeout(() => {
      if (!settled) setPhase('nosession')
    }, 2500)

    return () => {
      clearTimeout(timer)
      sub.subscription.unsubscribe()
    }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 8) {
      setError(t('tooShort'))
      return
    }
    if (password !== confirm) {
      setError(t('mismatch'))
      return
    }

    const supabase = clientRef.current ?? createClient()
    setLoading(true)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    if (updateError) {
      setError(t('error'))
      setLoading(false)
      return
    }

    setDone(true)
    setLoading(false)
    setTimeout(() => {
      router.push(`/${locale}/admin`)
      router.refresh()
    }, 1200)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-100 px-5 py-10">
      <div className="section-card w-full max-w-sm">
        <h1 className="font-serif text-2xl font-semibold text-neutral-900">
          {phase === 'nosession' ? t('invalidTitle') : t('title')}
        </h1>
        <div className="mt-2 h-0.5 w-10 rounded bg-primary-500" />

        {phase === 'checking' && (
          <p className="mt-4 text-sm text-neutral-500">{t('checking')}</p>
        )}

        {phase === 'nosession' && (
          <>
            <p className="mt-3 text-sm text-neutral-600">{t('invalid')}</p>
            <Link
              href={`/${locale}/admin/login`}
              className="btn-secondary mt-5 inline-block"
            >
              {t('backToLogin')}
            </Link>
          </>
        )}

        {phase === 'ready' && (
          <>
            <p className="mt-3 text-sm text-neutral-500">{t('subtitle')}</p>
            <form onSubmit={handleSubmit} className="mt-6 space-y-5" noValidate>
              <div className="form-field">
                <label className="form-label" htmlFor="password">
                  {t('password')}
                </label>
                <input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  className="bdc-input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              <div className="form-field">
                <label className="form-label" htmlFor="confirm">
                  {t('confirm')}
                </label>
                <input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  className="bdc-input"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                />
              </div>

              {error && <p className="text-sm text-danger-600">{error}</p>}
              {done && <p className="text-sm text-neutral-700">✓ {t('success')}</p>}

              <button
                type="submit"
                disabled={loading || done}
                className="btn-primary w-full disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? t('saving') : t('submit')}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
