import { createBrowserClient } from '@supabase/ssr'

// Browser Supabase client for client components (login form, logout button).
// Reads only the public env vars — never the service-role key (that's B7).
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
