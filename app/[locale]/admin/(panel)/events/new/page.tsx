import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import EventStepper from '@/components/admin/EventStepper'
import { getAdminContext } from '@/modules/auth'
import { getCentersForAdminSelect } from '@/modules/events'

// 7-step event create form. The stepper validates with eventCreateSchema and on
// the final step POSTs the full payload to /api/admin/events (createdBy is set
// from the session server-side, never the body).
//
// The centre dropdown is scoped to what the caller may actually create for: an
// ADMIN sees only their assigned centres (matches the createEvent ownership
// guard); SUPER_ADMIN sees all. An ADMIN with no assigned centre gets a notice
// instead of an empty picker.
export default async function NewEventPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const ctx = await getAdminContext()
  if (!ctx) redirect(`/${locale}/admin/login`)

  const t = await getTranslations('admin.eventForm')
  const centers = await getCentersForAdminSelect(ctx)

  return (
    <div>
      <header className="mb-6">
        <h1 className="font-serif text-3xl font-semibold text-neutral-900">
          {t('newTitle')}
        </h1>
        <div className="mt-2 h-0.5 w-12 rounded bg-primary-500" />
      </header>
      {centers.length === 0 ? (
        <div className="section-card text-neutral-600">{t('noCenters')}</div>
      ) : (
        <EventStepper centers={centers} />
      )}
    </div>
  )
}
