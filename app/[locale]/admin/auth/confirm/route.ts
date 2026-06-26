import { type EmailOtpType } from '@supabase/supabase-js'
import { type NextRequest } from 'next/server'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

// Landing route for the Supabase invite + password-reset e-mails. The e-mail
// templates link here with `?token_hash=...&type=invite|recovery`.
//
// WHY SERVER-SIDE: we verify the token with verifyOtp HERE, on the server. That
// establishes a session for *the token's user* in the cookies, REPLACING any
// session already present in this browser. This is the fix for the security bug
// where clicking an invite link while logged in as the super-admin changed the
// SUPER-ADMIN's password (the old client page fell back to the ambient session
// and never consumed the token). Verifying server-side makes the identity come
// only from the token, never from whoever happened to be logged in.
//
// On success → /admin/set-password (now holding the token user's session) to
// choose a password. On a missing/expired/invalid token → back to login.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ locale: string }> },
) {
  const { locale } = await params
  const { searchParams } = new URL(request.url)
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null

  if (token_hash && type) {
    const supabase = await createClient()
    const { error } = await supabase.auth.verifyOtp({ type, token_hash })
    if (!error) {
      redirect(`/${locale}/admin/set-password`)
    }
  }

  redirect(`/${locale}/admin/login?error=link_invalid`)
}
