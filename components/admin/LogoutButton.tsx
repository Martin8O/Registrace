'use client'

import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'

// Real Supabase logout: signOut() clears the auth cookies, then we redirect to
// the localized login and refresh so the proxy guard re-runs server-side.
export default function LogoutButton({ className = '' }: { className?: string }) {
  const router = useRouter()
  const locale = useLocale()
  const t = useTranslations('admin.nav')

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push(`/${locale}/admin/login`)
    router.refresh()
  }

  return (
    <button type="button" onClick={handleLogout} className={className}>
      {t('logout')}
    </button>
  )
}
