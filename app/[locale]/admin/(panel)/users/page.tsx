import { redirect } from 'next/navigation'
import { getAdminContext } from '@/modules/auth'
import { listUsers } from '@/modules/users'
import { getCentersForSelect } from '@/modules/events'
import UsersManager from '@/components/admin/UsersManager'

// SUPER_ADMIN-only management page. Gating is server-side (a non-super admin is
// redirected to the dashboard); the APIs the island calls are independently
// guarded by requireSuperAdmin(), so hiding the page is UX, not the security
// boundary. Lists live User + UserCenter rows.
export default async function AdminUsersPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const ctx = await getAdminContext()
  if (!ctx) redirect(`/${locale}/admin/login`)
  if (ctx.role !== 'SUPER_ADMIN') redirect(`/${locale}/admin`)

  const [users, centers] = await Promise.all([listUsers(ctx), getCentersForSelect()])

  return (
    <UsersManager
      users={users}
      centers={centers}
      currentUserId={ctx.userId}
      isOwner={ctx.isOwner}
    />
  )
}
