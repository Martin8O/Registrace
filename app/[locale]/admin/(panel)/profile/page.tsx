'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'

// Every admin / super-admin can view + change their own sign-in email and
// password here, against the browser Supabase client (auth.updateUser). The
// current email is read live from the session. Email change triggers Supabase's
// own confirmation flow (a verification link to the new address); password
// change applies immediately after a successful call.
export default function ProfilePage() {
  const t = useTranslations('admin.profile')

  const [currentEmail, setCurrentEmail] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    createClient()
      .auth.getUser()
      .then(({ data }) => {
        if (data.user?.email) setCurrentEmail(data.user.email)
      })
  }, [])

  const handleChangeEmail = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setToast(null)
    setBusy(true)
    try {
      const { error: err } = await createClient().auth.updateUser({ email: newEmail })
      if (err) {
        setError(t('emailFailed'))
      } else {
        setToast(t('emailSaved'))
        setNewEmail('')
      }
    } catch {
      setError(t('emailFailed'))
    } finally {
      setBusy(false)
    }
  }

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setToast(null)
    setError(null)
    if (password !== confirm) {
      setError(t('passwordMismatch'))
      return
    }
    setBusy(true)
    try {
      const { error: err } = await createClient().auth.updateUser({ password })
      if (err) {
        setError(t('passwordFailed'))
      } else {
        setToast(t('passwordSaved'))
        setPassword('')
        setConfirm('')
      }
    } catch {
      setError(t('passwordFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-serif text-3xl font-semibold text-neutral-900">
          {t('title')}
        </h1>
        <div className="mt-2 h-0.5 w-12 rounded bg-primary-500" />
        <p className="mt-3 text-neutral-500">{t('subtitle')}</p>
      </header>

      {toast && (
        <div className="rounded-lg border border-success-500/40 bg-success-50 p-3 text-sm text-success-700">
          {toast}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-danger-500/40 bg-danger-50 p-3 text-sm text-danger-700">
          {error}
        </div>
      )}

      <section className="section-card max-w-md space-y-5">
        <form onSubmit={handleChangeEmail} className="space-y-4" noValidate>
          <div>
            <label className="form-label" htmlFor="current-email">
              {t('currentEmail')}
            </label>
            <input
              id="current-email"
              type="email"
              className="bdc-input bg-neutral-50"
              value={currentEmail}
              readOnly
            />
          </div>
          <div>
            <label className="form-label" htmlFor="new-email">
              {t('newEmail')}
            </label>
            <input
              id="new-email"
              type="email"
              className="bdc-input"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('changeEmail')}
          </button>
        </form>
      </section>

      <section className="section-card max-w-md">
        <form onSubmit={handleChangePassword} className="space-y-4" noValidate>
          <div>
            <label className="form-label" htmlFor="new-password">
              {t('newPassword')}
            </label>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              className="bdc-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div>
            <label className="form-label" htmlFor="confirm-password">
              {t('confirmPassword')}
            </label>
            <input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              className="bdc-input"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('changePassword')}
          </button>
        </form>
      </section>
    </div>
  )
}
