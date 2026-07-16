'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { authErrorKey } from '@/lib/auth-errors'
import { isPasswordValid } from '@/lib/validation/password'
import { PasswordRequirements } from '@/components/admin/PasswordRequirements'
import { PasswordInput } from '@/components/admin/PasswordInput'
import { PasswordMatch } from '@/components/admin/PasswordMatch'

// "Set your password" page — reached ONLY after /admin/auth/confirm has verified
// the invite/reset token server-side and put the token user's session in the
// cookies. Here we just let that user choose a password (updateUser).
//
// SECURITY: this page must NEVER change a password using an *ambient* session.
// The earlier bug was exactly that — an invite link, clicked while the
// super-admin was logged in, fell back to the super-admin's session and changed
// THEIR password. Two guards now:
//   1) Tokens are verified server-side (auth/confirm), so the session here is the
//      token user's, replacing any prior one.
//   2) If we detect a raw auth token in the URL, it means we were reached by an
//      OLD direct link (not via auth/confirm). We refuse and ask for a fresh
//      link — we do NOT fall back to whatever session is present.
export default function SetPasswordPage() {
  const router = useRouter()
  const locale = useLocale()
  const t = useTranslations('admin.setPassword')
  const tErr = useTranslations('admin.authErrors')
  const tPolicy = useTranslations('admin.passwordPolicy')

  const clientRef = useRef<ReturnType<typeof createClient> | null>(null)
  const [phase, setPhase] = useState<'checking' | 'ready' | 'invalid'>('checking')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  // The setState below is deliberate: `window` does not exist during SSR, so the
  // token check cannot run in render, and seeding `phase` from a lazy useState
  // initializer would make the server render disagree with the first client
  // render (hydration mismatch). The 'checking' → 'invalid'/'ready' transition
  // after hydration is the whole point of this effect. Do NOT "fix" this by
  // trusting an ambient session — see the SECURITY note above.
  useEffect(() => {
    // A raw auth token in the URL ⇒ reached by an old direct link, not through
    // the server confirm route. Refuse rather than touch any ambient session.
    const raw = (window.location.hash || '') + (window.location.search || '')
    if (/access_token=|token_hash=|[?&]code=|[?&]type=|error=/.test(raw)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only URL check after hydration; see above
      setPhase('invalid')
      return
    }
    const supabase = createClient()
    clientRef.current = supabase
    supabase.auth.getSession().then(({ data }) => {
      setPhase(data.session ? 'ready' : 'invalid')
    })
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    // Re-check on submit even though the button is disabled until the policy is
    // met — the disabled attribute is a hint, not a guarantee. (The real gate is
    // Supabase's own policy; see lib/validation/password.)
    if (!isPasswordValid(password)) {
      setError(tPolicy('notMetSummary'))
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
      // Tell the admin WHY, in their own language. Without this every rejection
      // looked identical ("try again") and they would retype the same password
      // forever. Branch on the stable `code`, never on `message` — the latter is
      // English-only GoTrue prose. Unknown code → generic message plus the raw
      // reason: still English, but better than losing it. See lib/auth-errors.
      const key = authErrorKey(updateError.code)
      setError(
        key
          ? tErr(key)
          : updateError.message
            ? `${t('error')} (${updateError.message})`
            : t('error')
      )
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
          {phase === 'invalid' ? t('invalidTitle') : t('title')}
        </h1>
        <div className="mt-2 h-0.5 w-10 rounded bg-primary-500" />

        {phase === 'checking' && (
          <p className="mt-4 text-sm text-neutral-500">{t('checking')}</p>
        )}

        {phase === 'invalid' && (
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
                <PasswordInput
                  id="password"
                  value={password}
                  onChange={setPassword}
                  describedBy="password-requirements"
                  required
                />
                <div id="password-requirements" className="mt-2">
                  <PasswordRequirements value={password} />
                </div>
              </div>

              <div className="form-field">
                <label className="form-label" htmlFor="confirm">
                  {t('confirm')}
                </label>
                <PasswordInput id="confirm" value={confirm} onChange={setConfirm} required />
                <PasswordMatch value={password} confirm={confirm} />
              </div>

              {error && <p className="text-sm text-danger-600">{error}</p>}
              {done && <p className="text-sm text-neutral-700">✓ {t('success')}</p>}

              <button
                type="submit"
                disabled={loading || done || !isPasswordValid(password) || password !== confirm}
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
