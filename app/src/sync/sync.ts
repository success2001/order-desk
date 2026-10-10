import type { OrderDb } from '../orders/db'
import type { Order } from '../orders/types'
import { fromRemote, toRemote, type RemoteOrderRow, type RemoteOrders } from './remote'

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
const CURSOR_KEY = 'pullCursor'
const MAX_ROUNDS = 100

export interface SyncResult {
  pushed: number
  pulled: number
}

/** Push local changes, then pull server changes. Throws SyncAuthError / SyncNetworkError from the remote. */
export async function syncOnce(db: OrderDb, remote: RemoteOrders): Promise<SyncResult> {
  const pushed = await pushChanges(db, remote)
  const pulled = await pullChanges(db, remote)
  return { pushed, pulled }
}

/** Sends unsynced orders. Returns how many were confirmed. */
export async function pushChanges(db: OrderDb, remote: RemoteOrders): Promise<number> {
  let confirmed = 0
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const dirty = await db.orders.where('synced').equals(0).limit(PUSH_BATCH).toArray()
    if (dirty.length === 0) break
    await remote.push(dirty.map(toRemote))
    confirmed += await markSynced(db, dirty)
  }
  return confirmed
}

/**
 * Marks sent orders as synced, unless they were changed again while the push
 * was in flight: those keep synced = 0 and go out in the next round.
 */
async function markSynced(db: OrderDb, sent: Order[]): Promise<number> {
  return db.transaction('rw', db.orders, async () => {
    let count = 0
    for (const order of sent) {
      const current = await db.orders.get(order.id)
      if (current && current.synced === 0 && current.updated_at === order.updated_at) {
        await db.orders.put({ ...current, synced: 1 })
        count++
      }
    }
    return count
  })
}

/** Fetches server changes since the last pull and applies them. Returns how many changed local data. */
export async function pullChanges(db: OrderDb, remote: RemoteOrders): Promise<number> {
  const cursor = (await db.meta.get(CURSOR_KEY))?.value ?? null
  let since = cursor ? new Date(Date.parse(cursor) - PULL_OVERLAP_MS).toISOString() : null
  let newest = cursor
  let applied = 0

  for (let page = 0; page < MAX_ROUNDS; page++) {
    const rows = await remote.pull(since, PULL_PAGE)
    if (rows.length > 0) {
      applied += await applyRemote(db, rows)
      since = rows[rows.length - 1].server_updated_at
      if (!newest || Date.parse(since) > Date.parse(newest)) newest = since
    }
    if (rows.length < PULL_PAGE) break
  }

  if (newest && newest !== cursor) await db.meta.put({ key: CURSOR_KEY, value: newest })
  return applied
}

/**
 * Applies server rows:
 * - no local copy, or local copy already in sync → take the server version
 * - local copy has unsent changes → keep it unless the server version is newer
 *   (the server would reject the older local change anyway)
 */
export async function applyRemote(db: OrderDb, rows: RemoteOrderRow[]): Promise<number> {
  return db.transaction('rw', db.orders, async () => {
    let applied = 0
    for (const row of rows) {
      const incoming = fromRemote(row)
      const local = await db.orders.get(incoming.id)
      const incomingTime = Date.parse(incoming.updated_at)

      if (local) {
        const localTime = Date.parse(local.updated_at)
        if (local.synced === 1 && localTime === incomingTime && local.deleted_at === incoming.deleted_at) continue
        if (local.synced === 0 && incomingTime <= localTime) continue
      }
      await db.orders.put(incoming)
      applied++
    }
    return applied
  })
}
