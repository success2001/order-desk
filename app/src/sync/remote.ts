import type { Order } from '../orders/types'

/** A row as stored in public.orders. */
export interface RemoteOrderRow extends Omit<Order, 'synced'> {
  vendor_id?: string
  /** Server clock, set by the orders_before_write trigger. Raw string to keep microseconds. */
  server_updated_at: string
}

/** What the sync engine needs from the server. Supabase in the app, an in-memory fake in unit tests. */
export interface RemoteOrders {
  /** Insert or update. The server silently skips rows older than what it holds. */
  push(rows: Omit<RemoteOrderRow, 'server_updated_at' | 'vendor_id'>[]): Promise<void>
  /** Rows changed after `since` (exclusive), oldest first, at most `limit`. `since` null = from the start. */
  pull(since: string | null, limit: number): Promise<RemoteOrderRow[]>
}

/** The session is missing, expired beyond refresh, or for a different vendor: the vendor must sign in again. */
export class SyncAuthError extends Error {
  constructor(message = 'Sign in again to sync') {
    super(message)
    this.name = 'SyncAuthError'
  }
}

/** The server could not be reached. Try again later. */
export class SyncNetworkError extends Error {
  constructor(message = 'Server unreachable') {
    super(message)
    this.name = 'SyncNetworkError'
  }
}

/** Local order → server row. vendor_id is filled in by the server from the session. */
export function toRemote(order: Order): Omit<RemoteOrderRow, 'server_updated_at' | 'vendor_id'> {
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
export function fromRemote(row: RemoteOrderRow): Order {
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
  }
}

function toIso(timestamp: string): string {
  return new Date(timestamp).toISOString()
}
