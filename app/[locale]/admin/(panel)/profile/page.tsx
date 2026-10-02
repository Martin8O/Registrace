import { redirect } from 'next/navigation'
import { getAdminContext } from '@/modules/auth'
import { ProfileForm } from '@/components/admin/ProfileForm'

// The form itself talks to Supabase Auth from the browser; this server shell
// exists so the page checks the session like every other panel page (pinned by
// app/[locale]/admin/panel-guard.test.ts).
export default async function ProfilePage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const ctx = await getAdminContext()
  if (!ctx) redirect(`/${locale}/admin/login`)

  return <ProfileForm />
}
