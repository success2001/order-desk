import { isAuthRetryableFetchError, type GoTrueClient } from '@supabase/auth-js'
import { PostgrestClient } from '@supabase/postgrest-js'
import {
  SyncAuthError,
  SyncDeferredError,
  SyncNetworkError,
  SyncRejectedError,
  type DeletionRecord,
  type RemoteDeletions,
  type RemoteRow,
  type RemoteTable,
} from './remote'

interface Options {
  auth: GoTrueClient
  /** The vendor whose on-device database is being synced. */
  vendorId: string
  url: string
  key: string
}

/** RemoteTables and RemoteDeletions backed by Supabase (PostgREST), authenticated as the signed-in vendor. */
export function createSupabaseRemote({ auth, vendorId, url, key }: Options) {
  async function client(): Promise<PostgrestClient> {
    const { data, error } = await auth.getSession()
    const session = data.session
    if (!session) {
      if (error && isAuthRetryableFetchError(error)) throw new SyncNetworkError()
      throw new SyncAuthError()
    }
    // Never upload one vendor's on-device data into another vendor's account.
    if (session.user.id !== vendorId) throw new SyncAuthError('Signed-in session belongs to a different account')

    return new PostgrestClient(`${url}/rest/v1`, {
      headers: { apikey: key, Authorization: `Bearer ${session.access_token}` },
    })
  }

  function check(result: { error: { message: string; code?: string } | null; status: number }): void {
    if (!result.error) return
    const { status, error } = result
    if (status === 0) throw new SyncNetworkError(error.message)
    if (status === 401) throw new SyncAuthError(error.message)
    // Foreign key missing (e.g. a payment whose order hasn't synced yet): retry later.
    if (error.code === '23503') throw new SyncDeferredError(`${error.code}: ${error.message}`)
    // The server refused the data itself (constraint, permission, unknown column…).
    // Timeouts and rate limits are temporary, so they are retried instead.
    if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
      throw new SyncRejectedError(`${error.code ? `${error.code}: ` : ''}${error.message}`)
    }
    throw new Error(`Sync failed (${status} ${error.code ?? ''}): ${error.message}`)
  }

  /** This vendor's hard deletes, via public.deleted_records_since. */
  function deletions(): RemoteDeletions {
    return {
      async since(after, limit) {
        const db = await client()
        const result = await db.rpc('deleted_records_since', {
          p_after_at: after?.at ?? null,
          p_after_table: after?.table ?? null,
          p_after_id: after?.id ?? null,
          p_limit: limit,
        })
        check(result)
        return (result.data ?? []) as DeletionRecord[]
      },
    }
  }

  function table<R extends RemoteRow>(name: string): RemoteTable<R> {
    return {
      async push(rows) {
        const db = await client()
        // vendor_id is omitted: the database fills it from the session (and RLS enforces it).
        // The client is untyped (no generated schema), so rows go as plain objects.
        check(await db.from(name).upsert(rows as Record<string, unknown>[], { onConflict: 'id' }))
      },

      async pull(since, limit) {
        const db = await client()
        let query = db.from(name).select('*')
        if (since) query = query.gt('server_updated_at', since)
        const result = await query.order('server_updated_at').order('id').limit(limit)
        check(result)
        return (result.data ?? []) as R[]
      },
    }
  }

  return { table, deletions }
}
