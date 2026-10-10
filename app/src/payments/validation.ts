import { PAYMENT_METHODS, type Payment } from './types'

// Mirrors the checks on public.payments, so invalid payments are caught on the
// device instead of being set aside during sync.

export const MAX_PAYMENT_KOBO = 100_000_000_000 // ₦1,000,000,000
export const MAX_BACKDATE_DAYS = 90
/** Same tolerance the server allows for phone clocks running ahead. */
const FUTURE_TOLERANCE_MS = 5 * 60_000

export type PaymentFields = Pick<Payment, 'amount_kobo' | 'paid_at' | 'method' | 'note' | 'created_at'>
export type PaymentErrors = Partial<Record<'amount_kobo' | 'paid_at' | 'method' | 'note', string>>

export function validatePayment(p: PaymentFields, now = new Date()): PaymentErrors {
  const errors: PaymentErrors = {}

  if (!Number.isSafeInteger(p.amount_kobo) || p.amount_kobo <= 0) errors.amount_kobo = 'Enter an amount greater than ₦0.'
  else if (p.amount_kobo > MAX_PAYMENT_KOBO) errors.amount_kobo = 'That amount is too large. Check it and try again.'

  const paidAt = Date.parse(p.paid_at)
  const recordedAt = Date.parse(p.created_at)
  if (Number.isNaN(paidAt)) errors.paid_at = 'Enter the date the payment was received.'
  else if (paidAt > now.getTime() + FUTURE_TOLERANCE_MS) errors.paid_at = 'The payment date can’t be in the future.'
  else if (paidAt < recordedAt - MAX_BACKDATE_DAYS * 86_400_000) {
    errors.paid_at = `Payments can only be backdated up to ${MAX_BACKDATE_DAYS} days.`
  }

  if (p.method !== null && !PAYMENT_METHODS.includes(p.method)) errors.method = 'Unknown payment method.'
  if (p.note && p.note.length > 500) errors.note = 'Note is too long (max 500 characters).'

  return errors
}
