import type { OrderDb } from '../orders/db'
import {
  SyncDeferredError,
  SyncRejectedError,
  type DeletionPosition,
  type RemoteDeletions,
  type RemoteRow,
  type SyncRecord,
} from './remote'
import type { SyncTable } from './tables'

// Sync rules (BUILD_PLAN.md §3): the device is the source of truth for the
// screen; changes are pushed, then the server's changes are pulled, and the most
// recent change (updated_at) wins on both sides.

export const PUSH_BATCH = 200
export const PULL_PAGE = 500
/**
 * Each pull re-reads this much before the last cursor, to catch rows whose
 * server_updated_at was stamped before a pull but committed just after it.
 * Re-applying a row is harmless.
 */
export const PULL_OVERLAP_MS = 10_000
const MAX_ROUNDS = 100

export interface SyncResult {
  pushed: number
  pulled: number
  /** Rows the server refused; kept on the device with synced = 2. */
  rejected: number
  /** Rows the server can't accept yet (e.g. their order isn't synced); retried on later syncs. */
  deferred: number
  /** Local rows removed because they were hard-deleted on the server. */
  removed: number
}

/**
 * Pushes every table, then pulls every table, in the given order, then removes
 * rows that were hard-deleted on the server (if `deletions` is given).
 * Order matters once tables reference each other (orders before payments).
 * Throws SyncAuthError / SyncNetworkError from the remote.
 */
export async function syncOnce(
  db: OrderDb,
  tables: readonly SyncTable[],
  deletions?: RemoteDeletions,
): Promise<SyncResult> {
  const result: SyncResult = { pushed: 0, pulled: 0, rejected: 0, deferred: 0, removed: 0 }
  for (const table of tables) {
    const { confirmed, rejected, deferred } = await pushChanges(db, table)
    result.pushed += confirmed
    result.rejected += rejected
    result.deferred += deferred
  }
  for (const table of tables) result.pulled += await pullChanges(db, table)
  if (deletions) result.removed = await applyDeletions(db, tables, deletions)
  return result
}

export const DELETIONS_PAGE = 500
const DELETIONS_CURSOR_KEY = 'deletionsCursor'
const NO_ID = '00000000-0000-0000-0000-000000000000'

/**
 * Removes local rows that were hard-deleted on the server, including rows with
 * unsent or rejected changes: the server would skip those changes anyway
 * (deleted stays deleted, D13). Re-reads PULL_OVERLAP_MS before the saved
 * position to catch late commits; removing a row twice is harmless.
 * Returns how many local rows were removed.
 */
export async function applyDeletions(
  db: OrderDb,
  tables: readonly SyncTable[],
  deletions: RemoteDeletions,
  pageSize = DELETIONS_PAGE,
): Promise<number> {
  const saved = await db.meta.get(DELETIONS_CURSOR_KEY)
  const cursor: DeletionPosition | null = saved ? (JSON.parse(saved.value) as DeletionPosition) : null
  let after: DeletionPosition | null = cursor
    ? { at: new Date(Date.parse(cursor.at) - PULL_OVERLAP_MS).toISOString(), table: '', id: NO_ID }
    : null
  let newest = cursor
  let removed = 0

  for (let page = 0; page < MAX_ROUNDS; page++) {
    const rows = await deletions.since(after, pageSize)
    for (const table of tables) {
      const ids = rows.filter((r) => r.table_name === table.name).map((r) => r.record_id)
      if (ids.length === 0) continue
      const local = table.local(db)
      removed += await db.transaction('rw', local, async () => {
        const present = (await local.bulkGet(ids)).filter(Boolean).length
        await local.bulkDelete(ids)
        return present
      })
    }
    if (rows.length > 0) {
      const last = rows[rows.length - 1]
      after = { at: last.deleted_at, table: last.table_name, id: last.record_id }
      if (!newest || Date.parse(after.at) >= Date.parse(newest.at)) newest = after
    }
    if (rows.length < pageSize) break
  }

  if (newest && newest !== cursor) await db.meta.put({ key: DELETIONS_CURSOR_KEY, value: JSON.stringify(newest) })
  return removed
}

export function cursorKey(table: Pick<SyncTable, 'name'>): string {
  return `pullCursor:${table.name}`
}

/**
 * Sends unsynced rows in batches. If the server refuses a batch, the rows are
 * retried one at a time so a single bad row cannot block the rest:
 * - rows the server refuses outright are set aside (synced = 2) with the reason
 * - rows it can't accept *yet* (SyncDeferredError) stay waiting for a later sync
 */
export async function pushChanges<L extends SyncRecord, R extends RemoteRow>(
  db: OrderDb,
  table: SyncTable<L, R>,
): Promise<{ confirmed: number; rejected: number; deferred: number }> {
  const local = table.local(db)
  const deferredIds = new Set<string>()
  let confirmed = 0
  let rejected = 0

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const dirty = await local
      .where('synced')
      .equals(0)
      .filter((row) => !deferredIds.has(row.id))
      .limit(PUSH_BATCH)
      .toArray()
    if (dirty.length === 0) break

    try {
      await table.remote.push(dirty.map((row) => table.toRemote(row)))
      confirmed += await settle(db, table, dirty, 1)
    } catch (err) {
      if (!(err instanceof SyncRejectedError || err instanceof SyncDeferredError)) throw err
      for (const row of dirty) {
        try {
          await table.remote.push([table.toRemote(row)])
          confirmed += await settle(db, table, [row], 1)
        } catch (rowErr) {
          if (rowErr instanceof SyncDeferredError) deferredIds.add(row.id)
          else if (rowErr instanceof SyncRejectedError) rejected += await settle(db, table, [row], 2, rowErr.message)
          else throw rowErr
        }
      }
    }
  }
  return { confirmed, rejected, deferred: deferredIds.size }
}

/**
 * Records the outcome for sent rows, unless they were changed again while the
 * push was in flight: those keep synced = 0 and go out in the next round.
 */
async function settle<L extends SyncRecord, R extends RemoteRow>(
  db: OrderDb,
  table: SyncTable<L, R>,
  sent: L[],
  state: 1 | 2,
  error: string | null = null,
): Promise<number> {
  const local = table.local(db)
  return db.transaction('rw', local, async () => {
    let count = 0
    for (const row of sent) {
      const current = await local.get(row.id)
      if (current && current.synced === 0 && current.updated_at === row.updated_at) {
        await local.put({ ...current, synced: state, sync_error: error })
        count++
      }
    }
    return count
  })
}

/** Fetches server changes since this table's last pull and applies them. Returns how many changed local data. */
export async function pullChanges<L extends SyncRecord, R extends RemoteRow>(
  db: OrderDb,
  table: SyncTable<L, R>,
): Promise<number> {
  const key = cursorKey(table)
  const cursor = (await db.meta.get(key))?.value ?? null
  let since = cursor ? new Date(Date.parse(cursor) - PULL_OVERLAP_MS).toISOString() : null
  let newest = cursor
  let applied = 0

  for (let page = 0; page < MAX_ROUNDS; page++) {
    const rows = await table.remote.pull(since, PULL_PAGE)
    if (rows.length > 0) {
      applied += await applyRemote(db, table, rows)
      since = rows[rows.length - 1].server_updated_at
      if (!newest || Date.parse(since) > Date.parse(newest)) newest = since
    }
    if (rows.length < PULL_PAGE) break
  }

  if (newest && newest !== cursor) await db.meta.put({ key, value: newest })
  return applied
}

/**
 * Applies server rows:
 * - no local copy, or local copy already in sync → take the server version
 * - local copy has unsent or rejected changes → keep it unless the server
 *   version is newer (the server would reject the older local change anyway)
 */
export async function applyRemote<L extends SyncRecord, R extends RemoteRow>(
  db: OrderDb,
  table: SyncTable<L, R>,
  rows: R[],
): Promise<number> {
  const local = table.local(db)
  return db.transaction('rw', local, async () => {
    let applied = 0
    for (const row of rows) {
      const incoming = table.fromRemote(row)
      const current = await local.get(incoming.id)
      const incomingTime = Date.parse(incoming.updated_at)

      if (current) {
        const localTime = Date.parse(current.updated_at)
        if (current.synced === 1 && localTime === incomingTime && current.deleted_at === incoming.deleted_at) continue
        if (current.synced !== 1 && incomingTime <= localTime) continue
      }
      await local.put(incoming)
      applied++
    }
    return applied
  })
}
