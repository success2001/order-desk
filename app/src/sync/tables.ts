import type { Table } from 'dexie'
import type { OrderDb } from '../orders/db'
import type { Order } from '../orders/types'
import { toIso, type OutgoingRow, type RemoteRow, type RemoteTable, type SyncRecord } from './remote'

/**
 * Everything the sync engine needs to know about one table.
 * Methods (not function properties) so a SyncTable<Order, …> can be used where a
 * general SyncTable is expected.
 */
export interface SyncTable<L extends SyncRecord = SyncRecord, R extends RemoteRow = RemoteRow> {
  /** Server table name; also names this table's fetch cursor. */
  readonly name: string
  readonly remote: RemoteTable<R>
  /** The local Dexie table (keyed by `id`). Insert type left open so Dexie's EntityTable fits. */
  local(db: OrderDb): Table<L, string, unknown>
  toRemote(local: L): OutgoingRow<R>
  fromRemote(row: R): L
}

// ---------------------------------------------------------------------------
// Orders (public.orders)
// ---------------------------------------------------------------------------

/** A row as stored in public.orders. */
export interface RemoteOrderRow extends RemoteRow, Omit<Order, 'synced' | 'sync_error'> {}

/** Local order → server row. vendor_id is filled in by the server from the session. */
export function toRemoteOrder(order: Order): OutgoingRow<RemoteOrderRow> {
  return {
    id: order.id,
    customer_name: order.customer_name,
    customer_phone: order.customer_phone,
    channel: order.channel,
    items: order.items,
    amount_due_kobo: order.amount_due_kobo,
    amount_paid_kobo: order.amount_paid_kobo,
    fulfilment_status: order.fulfilment_status,
    notes: order.notes,
    created_at: order.created_at,
    updated_at: order.updated_at,
    deleted_at: order.deleted_at,
  }
}

/** Server row → local order, marked in sync. Timestamps normalised to the app's ISO format. */
export function fromRemoteOrder(row: RemoteOrderRow): Order {
  return {
    id: row.id,
    customer_name: row.customer_name,
    customer_phone: row.customer_phone,
    channel: row.channel,
    items: row.items,
    amount_due_kobo: Number(row.amount_due_kobo),
    amount_paid_kobo: Number(row.amount_paid_kobo),
    fulfilment_status: row.fulfilment_status,
    notes: row.notes,
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
    deleted_at: row.deleted_at ? toIso(row.deleted_at) : null,
    synced: 1,
    sync_error: null,
  }
}

export function ordersTable(remote: RemoteTable<RemoteOrderRow>): SyncTable<Order, RemoteOrderRow> {
  return {
    name: 'orders',
    remote,
    local: (db) => db.orders,
    toRemote: toRemoteOrder,
    fromRemote: fromRemoteOrder,
  }
}
