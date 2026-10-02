import { redirect } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages } from 'next-intl/server'
import AdminSidebar from '@/components/admin/AdminSidebar'
import { getAdminContext } from '@/modules/auth'

// Authenticated admin shell — sidebar (with logout + language switcher) wrapping
// every panel page. The login route lives outside this group so it renders bare.
//
// The proxy.ts session-presence guard is NOT the only gate: its matcher skips
// every path containing a dot, so the shell refuses to render without an admin
// here as well. A layout is not re-rendered on every navigation, though, so each
// panel page still checks for itself (pinned by ../panel-guard.test.ts) — this
// is the backstop for a page that forgets. The role also lets the sidebar hide
// SUPER_ADMIN-only links (UX only; pages and handlers enforce the boundary).
export default async function PanelLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const ctx = await getAdminContext()
  const locale = await getLocale()
  if (!ctx) redirect(`/${locale}/admin/login`)
  // Re-provide the messages plus the "?" hints (Czech only), which the root
  // layout withholds from the public site. The long help page is not sent.
  const { help, ...messages } = (await getMessages()) as Record<string, unknown> & {
    help: { hints: unknown }
  }

  return (
    <NextIntlClientProvider locale={locale} messages={{ ...messages, help: { hints: help.hints } }}>
      <div className="min-h-screen bg-stone-100 md:flex">
        <AdminSidebar role={ctx.role} />
        <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">
          <div className="max-w-admin mx-auto">{children}</div>
        </main>
      </div>
    </NextIntlClientProvider>
  )
}
