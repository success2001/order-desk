import { AuthClient } from '@supabase/auth-js'

// Uses Supabase's auth module directly instead of @supabase/supabase-js, which
// also bundles realtime, storage and functions we don't use (53 KB vs 27 KB
// gzipped together with postgrest-js for sync in T7).

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!url || !key) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY (see .env.example).')
}

export const SUPABASE_URL = url
export const SUPABASE_KEY = key

export const auth = new AuthClient({
  url: `${url}/auth/v1`,
  headers: { apikey: key },
  // Same storage key supabase-js would use, so sessions are compatible if we ever switch.
  storageKey: `sb-${new URL(url).hostname.split('.')[0]}-auth-token`,
  persistSession: true,
  autoRefreshToken: true,
  // Sign-in uses a typed code, never a link, so there is nothing to read from the URL.
  detectSessionInUrl: false,
})
