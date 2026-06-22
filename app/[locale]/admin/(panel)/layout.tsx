import AdminSidebar from '@/components/admin/AdminSidebar'
import { getAdminContext } from '@/modules/auth'

// Authenticated admin shell — sidebar (with logout + language switcher) wrapping
// every panel page. The login route lives outside this group so it renders bare.
// Access is gated by the proxy.ts session-presence guard; here we resolve the
// role so the sidebar can hide SUPER_ADMIN-only links (the pages/handlers still
// enforce the boundary server-side — this is UX only).
export default async function PanelLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const ctx = await getAdminContext()

  return (
    <div className="min-h-screen bg-stone-100 md:flex">
      <AdminSidebar role={ctx?.role ?? null} />
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">
        <div className="max-w-admin mx-auto">{children}</div>
      </main>
    </div>
  )
}
