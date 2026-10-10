// Mirrors public.orders (supabase/migrations/20261010000000_create_orders.sql).
// Field names match the database columns so sync can pass rows through unchanged.

import type { SyncRecord, SyncState } from '../sync/remote'

export const CHANNELS = ['whatsapp', 'instagram', 'other'] as const
export type Channel = (typeof CHANNELS)[number]

export const FULFILMENT_STATUSES = ['pending', 'dispatched', 'delivered', 'cancelled'] as const
export type FulfilmentStatus = (typeof FULFILMENT_STATUSES)[number]

export type PaymentStatus = 'unpaid' | 'part-paid' | 'paid'

export interface Order extends SyncRecord {
  id: string
  customer_name: string
  customer_phone: string | null
  channel: Channel
  items: string
  amount_due_kobo: number
  fulfilment_status: FulfilmentStatus
  /**
   * ISO 8601 when the order last became delivered; null whenever it isn't delivered.
   * Managed by the repository (deliveredAt), never set directly.
   */
  delivered_at: string | null
  notes: string | null
  /** ISO 8601, device clock. */
  created_at: string
  /** ISO 8601, device clock. Drives "most recent change wins". */
  updated_at: string
  /** ISO 8601 when soft-deleted, otherwise null. */
  deleted_at: string | null
  /** Local only: 0 = changes not yet sent, 1 = in sync, 2 = rejected by the server. Numeric so Dexie can index it. */
  synced: SyncState
  /** Local only: the server's reason when synced = 2. */
  sync_error?: string | null
}

/** Fields a vendor can set when creating an order. */
export interface NewOrderInput {
  customer_name: string
  customer_phone?: string | null
  channel?: Channel
  items: string
  amount_due_kobo: number
  fulfilment_status?: FulfilmentStatus
  notes?: string | null
}

/** Fields a vendor can change on an existing order. */
export type OrderChanges = Partial<
  Omit<Order, 'id' | 'created_at' | 'updated_at' | 'deleted_at' | 'delivered_at' | 'synced' | 'sync_error'>
>
