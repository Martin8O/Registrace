import AdminSidebar from '@/components/admin/AdminSidebar'

// Authenticated admin shell — sidebar (with logout + language switcher) wrapping
// every panel page. The login route lives outside this group so it renders bare.
// Access is gated by the proxy.ts session-presence guard (redirect to login when
// unauthenticated). TODO(B7): role-based scoping + center-ownership 403.
export default function PanelLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-stone-100 md:flex">
      <AdminSidebar />
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">
        <div className="max-w-admin mx-auto">{children}</div>
      </main>
    </div>
  )
}
