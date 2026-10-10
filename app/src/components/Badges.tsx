import { FULFILMENT_LABELS, PAYMENT_LABELS } from '../orders/labels'
import { paymentStatus } from '../orders/payment'
import type { Order } from '../orders/types'

/** `paid` is the order's total received (sum of its payments that aren't voided). */
export function PaymentBadge({ order, paid }: { order: Order; paid: number }) {
  const status = paymentStatus(order.amount_due_kobo, paid)
  return <span className={`badge badge--${status}`}>{PAYMENT_LABELS[status]}</span>
}

export function FulfilmentBadge({ order }: { order: Order }) {
  const status = order.fulfilment_status
  return <span className={`badge badge--${status}`}>{FULFILMENT_LABELS[status]}</span>
}
