import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { getAdminContext } from '@/modules/auth'
import { listAuditLogs } from '@/lib/audit'
import LogsTable from '@/components/admin/LogsTable'

// SUPER_ADMIN-only audit-log page (P4). Gating is server-side (a non-super admin
// is redirected); the /api/admin/audit-log endpoint the page mirrors is itself
// guarded by requireSuperAdmin, so hiding the nav item is UX, not the boundary.
// Reads the shared listAuditLogs (same source as the API).
export default async function AdminLogsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const ctx = await getAdminContext()
  if (!ctx) redirect(`/${locale}/admin/login`)
  if (ctx.role !== 'SUPER_ADMIN') redirect(`/${locale}/admin`)

  const t = await getTranslations('admin.logs')
  const rows = await listAuditLogs()

  return (
    <div>
      <header className="mb-6">
        <h1 className="font-serif text-3xl font-semibold text-neutral-900">{t('title')}</h1>
        <div className="mt-2 h-0.5 w-12 rounded bg-primary-500" />
        <p className="mt-3 text-neutral-500">{t('subtitle')}</p>
      </header>
      <LogsTable rows={rows} />
    </div>
  )
}
