import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { getAdminContext } from '@/modules/auth'
import { listAdminEvents } from '@/modules/events'
import AdminEventsTable from '@/components/admin/AdminEventsTable'

// Server component: resolves the admin context (ownership scoping happens in
// listAdminEvents — ADMIN sees own events, SUPER_ADMIN all) and hands the rows
// to a client table that owns the status filter. Unauthenticated → login (also
// guarded at the edge by proxy.ts).
export default async function AdminEventsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const ctx = await getAdminContext()
  if (!ctx) redirect(`/${locale}/admin/login`)

  const events = await listAdminEvents(ctx)
  const t = await getTranslations('admin')
  const base = `/${locale}/admin`

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-neutral-900">
            {t('events.title')}
          </h1>
          <div className="mt-2 h-0.5 w-12 rounded bg-primary-500" />
        </div>
        <Link href={`${base}/events/new`} className="btn-primary inline-block">
          {t('events.new')}
        </Link>
      </header>

      <AdminEventsTable events={events} />
    </div>
  )
}
