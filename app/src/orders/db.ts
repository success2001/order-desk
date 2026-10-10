import Dexie, { type EntityTable } from 'dexie'
import type { Payment } from '../payments/types'
import type { Order } from './types'

/** Small key/value store for sync bookkeeping (e.g. last fetch time), used from T7. */
export interface MetaEntry {
  key: string
  value: string
}

export type OrderDb = Dexie & {
  orders: EntityTable<Order, 'id'>
  payments: EntityTable<Payment, 'id'>
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
  // v2: delivered_at, indexed for "delivered this period" reports.
  db.version(2)
    .stores({ orders: 'id, created_at, updated_at, synced, fulfilment_status, delivered_at' })
    .upgrade((tx) =>
      tx
        .table<Order, string>('orders')
        .toCollection()
        .modify((order) => {
          // Orders saved before v2 have no delivered_at; best guess is their last change.
          if (order.delivered_at === undefined) {
            order.delivered_at = order.fulfilment_status === 'delivered' ? order.updated_at : null
          }
        }),
    )
  // v3: payment history. "Paid" is now the sum of an order's payments, so any
  // amount stored on an order before v3 becomes one payment.
  db.version(3)
    .stores({ payments: 'id, order_id, paid_at, updated_at, synced' })
    .upgrade(async (tx) => {
      const legacy = (await tx.table('orders').toArray()) as (Order & { amount_paid_kobo?: number })[]
      const payments: Payment[] = legacy
        .filter((o) => !o.deleted_at && (o.amount_paid_kobo ?? 0) > 0)
        .map((o) => ({
          // The order's id: unique within payments, and the same on every device
          // that upgrades this order, so syncing can't create duplicates.
          id: o.id,
          order_id: o.id,
          amount_kobo: o.amount_paid_kobo!,
          // Best guess: received at the order's last change, recorded then too
          // (keeps it within the server's 90-day backdating rule).
          paid_at: o.updated_at,
          method: null,
          note: null,
          created_at: o.updated_at,
          updated_at: o.updated_at,
          deleted_at: null,
          synced: 0,
          sync_error: null,
        }))
      await tx.table('payments').bulkPut(payments)
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
