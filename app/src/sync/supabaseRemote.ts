import { isAuthRetryableFetchError, type GoTrueClient } from '@supabase/auth-js'
import { PostgrestClient } from '@supabase/postgrest-js'
import { SyncAuthError, SyncNetworkError, type RemoteOrderRow, type RemoteOrders } from './remote'

interface Options {
  auth: GoTrueClient
  /** The vendor whose on-device database is being synced. */
  vendorId: string
  url: string
  key: string
}

/** RemoteOrders backed by Supabase (PostgREST), authenticated as the signed-in vendor. */
export function createSupabaseRemote({ auth, vendorId, url, key }: Options): RemoteOrders {
  async function client(): Promise<PostgrestClient> {
    const { data, error } = await auth.getSession()
    const session = data.session
    if (!session) {
      if (error && isAuthRetryableFetchError(error)) throw new SyncNetworkError()
      throw new SyncAuthError()
    }
    // Never upload one vendor's on-device orders into another vendor's account.
    if (session.user.id !== vendorId) throw new SyncAuthError('Signed-in session belongs to a different account')

    return new PostgrestClient(`${url}/rest/v1`, {
      headers: { apikey: key, Authorization: `Bearer ${session.access_token}` },
    })
  }

  function check(result: { error: { message: string; code?: string } | null; status: number }): void {
    if (!result.error) return
    if (result.status === 0) throw new SyncNetworkError(result.error.message)
    if (result.status === 401) throw new SyncAuthError(result.error.message)
    throw new Error(`Sync failed (${result.status} ${result.error.code ?? ''}): ${result.error.message}`)
  }

  return {
    async push(rows) {
      const db = await client()
      // vendor_id is omitted: the database fills it from the session (and RLS enforces it).
      check(await db.from('orders').upsert(rows, { onConflict: 'id' }))
    },

    async pull(since, limit) {
      const db = await client()
      let query = db.from('orders').select('*')
      if (since) query = query.gt('server_updated_at', since)
      const result = await query.order('server_updated_at').order('id').limit(limit)
      check(result)
      return (result.data ?? []) as RemoteOrderRow[]
    },
  }
}
