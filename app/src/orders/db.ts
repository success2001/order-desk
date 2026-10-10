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
 * Opens the on-device database. One database per signed-in vendor
 * (e.g. `orders-<user id>`) keeps accounts apart on a shared phone.
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
