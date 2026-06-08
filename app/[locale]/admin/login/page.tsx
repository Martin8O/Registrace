'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'

// Standalone admin login — NOT inside the (panel) shell (no sidebar). Real
// Supabase Auth via signInWithPassword. On success → /[locale]/admin + refresh
// so the proxy guard re-evaluates the now-present session server-side.
export default function AdminLoginPage() {
  const router = useRouter()
  const locale = useLocale()
  const t = useTranslations('admin.login')

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const supabase = createClient()
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (signInError) {
      setError(t('error'))
      setLoading(false)
      return
    }

    router.push(`/${locale}/admin`)
    router.refresh()
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-100 px-5 py-10">
      <div className="section-card w-full max-w-sm">
        <h1 className="font-serif text-2xl font-semibold text-neutral-900">
          {t('title')}
        </h1>
        <div className="mt-2 h-0.5 w-10 rounded bg-primary-500" />
        <p className="mt-3 text-sm text-neutral-500">{t('subtitle')}</p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-5" noValidate>
          <div className="form-field">
            <label className="form-label" htmlFor="email">
              {t('email')}
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              className="bdc-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="form-field">
            <label className="form-label" htmlFor="password">
              {t('password')}
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              className="bdc-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {error && <p className="text-sm text-danger-600">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? t('signingIn') : t('submit')}
          </button>
        </form>
      </div>
    </div>
  )
}
