import { redirect } from 'next/navigation'
import { getAdminContext } from '@/modules/auth'
import { listCentersAdmin } from '@/modules/centers'
import CentersManager from '@/components/admin/CentersManager'

// SUPER_ADMIN-only centre management. Server-side gating (non-super → dashboard);
// the PUT endpoint is independently guarded by requireSuperAdmin(). Lists live
// centres with their assigned ADMIN emails.
export default async function AdminCentersPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const ctx = await getAdminContext()
  if (!ctx) redirect(`/${locale}/admin/login`)
  if (ctx.role !== 'SUPER_ADMIN') redirect(`/${locale}/admin`)

  const centers = await listCentersAdmin(ctx)

  return <CentersManager centers={centers} />
}
