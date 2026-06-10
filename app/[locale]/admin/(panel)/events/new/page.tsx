import { getTranslations } from 'next-intl/server'
import EventStepper from '@/components/admin/EventStepper'
import { getCentersForSelect } from '@/modules/events'

// 7-step event create form. The stepper validates with eventCreateSchema and on
// the final step POSTs the full payload to /api/admin/events (createdBy is set
// from the session server-side, never the body).
export default async function NewEventPage() {
  const t = await getTranslations('admin.eventForm')
  const centers = await getCentersForSelect()

  return (
    <div>
      <header className="mb-6">
        <h1 className="font-serif text-3xl font-semibold text-neutral-900">
          {t('newTitle')}
        </h1>
        <div className="mt-2 h-0.5 w-12 rounded bg-primary-500" />
      </header>
      <EventStepper centers={centers} />
    </div>
  )
}
