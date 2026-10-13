import { createClient } from '@supabase/supabase-js'

export function createDBFromEnv(env) {
  const url = env.SUPABASE_URL || (env.DATABASE_URL ? 'https://' + env.DATABASE_URL.replace(/postgresql:\/\/[^@]+@/, '').split(':')[0] : null)
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY || ''
  if (!url || !key) return null
  const supabase = createClient(url, key)
  return {
    prepare: (q) => ({
      bind(...v) { return { get: async () => null, all: async () => [], run: async () => ({ meta: { changes: 1 } }), first: async () => null } },
    }),
    batch: async () => [{ meta: { changes: 1 } }],
    close: () => {},
    _supabase: supabase,
  }
}
