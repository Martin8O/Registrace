import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// SERVER-ONLY Supabase admin client (service-role key). The service-role key
// bypasses Row Level Security and grants full auth-admin powers, so it must
// NEVER reach the browser:
//   - it is read from SUPABASE_SERVICE_ROLE_KEY (NOT a NEXT_PUBLIC_ var, so it is
//     never inlined into the client bundle), and
//   - we throw if this module is ever evaluated in a browser context.
// (The idiomatic `import 'server-only'` guard isn't used — that package isn't a
// dependency and P2.5 adds none.) Used only by modules/users for invite / role /
// password-reset operations via Supabase Auth's own email (decision 5).

let cached: SupabaseClient | null = null

export function createAdminClient(): SupabaseClient {
  if (typeof window !== 'undefined') {
    throw new Error('createAdminClient must never be called in the browser')
  }
  if (cached) return cached

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL not configured')
  }

  cached = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return cached
}
