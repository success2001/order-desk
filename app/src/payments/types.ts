// Mirrors public.payments (supabase/migrations/20261010140000_payments.sql).
// Field names match the database columns so sync can pass rows through unchanged.

import type { SyncRecord, SyncState } from '../sync/remote'

export const PAYMENT_METHODS = ['transfer', 'cash', 'pos', 'other'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

/** One payment received for an order. Voided (or refunded) = deleted_at set. */
export interface Payment extends SyncRecord {
  id: string
  order_id: string
  amount_kobo: number
  /** ISO 8601: when the money was received. May be backdated up to 90 days. */
  paid_at: string
  method: PaymentMethod | null
  note: string | null
  /** ISO 8601, device clock: when the payment was recorded. */
  created_at: string
  updated_at: string
  deleted_at: string | null
  synced: SyncState
  sync_error?: string | null
}

export interface NewPaymentInput {
  order_id: string
  amount_kobo: number
  /** Defaults to now. */
  paid_at?: string
  method?: PaymentMethod | null
  note?: string | null
}
