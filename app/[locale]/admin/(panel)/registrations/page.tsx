import { redirect } from 'next/navigation'
import { getAdminContext } from '@/modules/auth'
import { listRegistrations, getEventMealStats } from '@/modules/registrations'
import RegistrationsTable from '@/components/admin/RegistrationsTable'

// Server component: resolves the admin context, loads the role/ownership-scoped
// registrations, and (when scoped to one event via ?event=) the per-day meal
// stats. A client island owns the centre/status filters. Unauthenticated →
// login (also guarded at the edge by proxy.ts).
export default async function AdminRegistrationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ event?: string }>
}) {
  const { locale } = await params
  const ctx = await getAdminContext()
  if (!ctx) redirect(`/${locale}/admin/login`)

  const { event: scopedEventId = null } = await searchParams
  const [rows, mealStats] = await Promise.all([
    listRegistrations(ctx),
    scopedEventId ? getEventMealStats(scopedEventId, ctx) : Promise.resolve([]),
  ])

  return (
    <RegistrationsTable rows={rows} scopedEventId={scopedEventId} mealStats={mealStats} />
  )
}
