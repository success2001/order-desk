import type { Order, PaymentStatus } from './types'

type Amounts = Pick<Order, 'amount_due_kobo' | 'amount_paid_kobo'>

/**
 * Payment status is derived from the amounts and never stored (BUILD_PLAN.md §3).
 * - paid: nothing left to pay, including ₦0 orders and overpayments
 * - unpaid: nothing received yet
 * - part-paid: something received, something still owed
 */
export function paymentStatus({ amount_due_kobo, amount_paid_kobo }: Amounts): PaymentStatus {
  if (amount_paid_kobo >= amount_due_kobo) return 'paid'
  if (amount_paid_kobo === 0) return 'unpaid'
  return 'part-paid'
}

/** Amount still owed in kobo. Negative means the customer overpaid. */
export function balanceKobo({ amount_due_kobo, amount_paid_kobo }: Amounts): number {
  return amount_due_kobo - amount_paid_kobo
}
