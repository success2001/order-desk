import type { PaymentStatus } from './types'

// Payment status is derived and never stored (BUILD_PLAN.md §3, D16):
// `paidKobo` is the sum of the order's payments that aren't voided
// (payments/repository.ts paidTotal / paidTotals).

/**
 * - paid: nothing left to pay, including ₦0 orders and overpayments
 * - unpaid: nothing received yet
 * - part-paid: something received, something still owed
 */
export function paymentStatus(amountDueKobo: number, paidKobo: number): PaymentStatus {
  if (paidKobo >= amountDueKobo) return 'paid'
  if (paidKobo === 0) return 'unpaid'
  return 'part-paid'
}

/** Amount still owed in kobo. Negative means the customer overpaid. */
export function balanceKobo(amountDueKobo: number, paidKobo: number): number {
  return amountDueKobo - paidKobo
}
