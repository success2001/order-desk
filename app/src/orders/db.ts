import Dexie, { type EntityTable } from 'dexie'
import type { Order } from './types'

/** Small key/value store for sync bookkeeping (e.g. last fetch time), used from T7. */
export interface MetaEntry {
  key: string
  value: string
}

export type OrderDb = Dexie & {
  orders: EntityTable<Order, 'id'>
  meta: EntityTable<MetaEntry, 'key'>
}

/**
 * One database per signed-in vendor keeps accounts apart on a shared phone.
 * "orderdesk-" replaced the earlier "orders-" names, which only ever held test
 * data and are deleted on startup (store.ts deleteLegacyDatabases), so nothing
 * in them can sync again.
 */
export const DB_PREFIX = 'orderdesk-'
export const LEGACY_DB_PREFIX = 'orders-'

export function vendorDbName(userId: string): string {
  return `${DB_PREFIX}${userId}`
}

/**
 * Opens an on-device database. Schema changes add a new db.version(n) with an
 * upgrade where needed; never edit an existing version's stores.
 */
export function openOrderDb(name: string): OrderDb {
  const db = new Dexie(name) as OrderDb
  db.version(1).stores({
    // Primary key first, then indexed fields.
    orders: 'id, created_at, updated_at, synced, fulfilment_status',
    meta: 'key',
  })
  return db
}

/**
 * Releases the database connection but lets it reopen on next use.
 * Plain db.close() disables the database for good (Dexie's default), so any
 * remount, e.g. React StrictMode in development, would make every later save fail.
 */
export function releaseOrderDb(db: OrderDb): void {
  db.close({ disableAutoOpen: false })
}
