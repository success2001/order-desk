import type { OrderDb } from '../orders/db'
import { SyncRejectedError, type RemoteRow, type SyncRecord } from './remote'
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
}

/**
 * Pushes every table, then pulls every table, in the given order.
 * Order matters once tables reference each other (orders before payments).
 * Throws SyncAuthError / SyncNetworkError from the remote.
 */
export async function syncOnce(db: OrderDb, tables: readonly SyncTable[]): Promise<SyncResult> {
  const result: SyncResult = { pushed: 0, pulled: 0, rejected: 0 }
  for (const table of tables) {
    const { confirmed, rejected } = await pushChanges(db, table)
    result.pushed += confirmed
    result.rejected += rejected
  }
  for (const table of tables) result.pulled += await pullChanges(db, table)
  return result
}

export function cursorKey(table: Pick<SyncTable, 'name'>): string {
  return `pullCursor:${table.name}`
}

/**
 * Sends unsynced rows in batches. If the server rejects a batch, the rows are
 * retried one at a time so a single bad row cannot block the rest; rows the
 * server still refuses are set aside (synced = 2) with the reason.
 */
export async function pushChanges<L extends SyncRecord, R extends RemoteRow>(
  db: OrderDb,
  table: SyncTable<L, R>,
): Promise<{ confirmed: number; rejected: number }> {
  const local = table.local(db)
  let confirmed = 0
  let rejected = 0

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const dirty = await local.where('synced').equals(0).limit(PUSH_BATCH).toArray()
    if (dirty.length === 0) break

    try {
      await table.remote.push(dirty.map((row) => table.toRemote(row)))
      confirmed += await settle(db, table, dirty, 1)
    } catch (err) {
      if (!(err instanceof SyncRejectedError)) throw err
      for (const row of dirty) {
        try {
          await table.remote.push([table.toRemote(row)])
          confirmed += await settle(db, table, [row], 1)
        } catch (rowErr) {
          if (!(rowErr instanceof SyncRejectedError)) throw rowErr
          rejected += await settle(db, table, [row], 2, rowErr.message)
        }
      }
    }
  }
  return { confirmed, rejected }
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
