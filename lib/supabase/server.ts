import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// Server Supabase client bound to Next.js request cookies, for server
// components and route handlers. `cookies()` is async in Next 16 — await it.
// Reads only the public env vars (never the service-role key — that's B7).
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // setAll called from a Server Component — safe to ignore; the
            // session is refreshed in proxy.ts (the middleware) instead.
          }
        },
      },
    },
  )
}
