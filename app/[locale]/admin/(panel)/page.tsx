import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { getAdminContext } from '@/modules/auth'
import { getAdminDashboardCounts, getCentersForAdminSelect } from '@/modules/events'

// Dashboard at /[locale]/admin — stat cards from live DB counts, scoped by role
// (ADMIN: own events + their registrations; SUPER_ADMIN: all). Server component;
// unauthenticated → login (also guarded at the edge by proxy.ts).
export default async function AdminDashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const ctx = await getAdminContext()
  if (!ctx) redirect(`/${locale}/admin/login`)

  const t = await getTranslations('admin.dashboard')
  const { events: totalEvents, registrations: totalRegistrations } =
    await getAdminDashboardCounts(ctx)
  const base = `/${locale}/admin`

  // An ADMIN is scoped to their assigned centres — surface which ones (they
  // reported not knowing). SUPER_ADMIN covers all, so no list is shown.
  const uiLocale = await getLocale()
  const myCenters =
    ctx.role === 'ADMIN' ? await getCentersForAdminSelect(ctx) : []

  return (
    <div>
      <header className="mb-8">
        <h1 className="font-serif text-3xl font-semibold text-neutral-900">
          {t('title')}
        </h1>
        <div className="mt-2 h-0.5 w-12 rounded bg-primary-500" />
        <p className="mt-3 text-neutral-500">{t('subtitle')}</p>
      </header>

      {ctx.role === 'ADMIN' && (
        <div className="section-card mb-5 max-w-md py-4">
          <p className="text-sm font-medium text-neutral-500">{t('yourCenters')}</p>
          <p className="mt-1 text-neutral-900">
            {myCenters.length > 0
              ? myCenters
                  .map((c) => (uiLocale === 'cs' ? c.name_cs : c.name_en))
                  .join(', ')
              : t('noCenters')}
          </p>
        </div>
      )}

      {/* Stat cards (centered count). Their action buttons live in a mirrored
          row BELOW the cards — same 2-column grid + width — so each button sits
          directly under its card on desktop, not inside it. */}
      <div className="grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="section-card flex flex-col items-center py-6 text-center">
          <p className="text-sm font-medium text-neutral-500">{t('totalEvents')}</p>
          <p className="mt-1 font-mono text-4xl font-semibold tabular-nums text-primary-600">
            {totalEvents}
          </p>
        </div>
        <div className="section-card flex flex-col items-center py-6 text-center">
          <p className="text-sm font-medium text-neutral-500">
            {t('totalRegistrations')}
          </p>
          <p className="mt-1 font-mono text-4xl font-semibold tabular-nums text-primary-600">
            {totalRegistrations}
          </p>
        </div>
      </div>

      <div className="mt-4 grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex justify-center">
          <Link href={`${base}/events`} className="btn-primary inline-block">
            {t('goToEvents')}
          </Link>
        </div>
        <div className="flex justify-center">
          <Link href={`${base}/registrations`} className="btn-secondary inline-block">
            {t('goToRegistrations')}
          </Link>
        </div>
      </div>
    </div>
  )
}
