import { FULFILMENT_LABELS, PAYMENT_LABELS } from '../orders/labels'
import { paymentStatus } from '../orders/payment'
import type { Order } from '../orders/types'

export function PaymentBadge({ order }: { order: Order }) {
  const status = paymentStatus(order)
  return <span className={`badge badge--${status}`}>{PAYMENT_LABELS[status]}</span>
}

export function FulfilmentBadge({ order }: { order: Order }) {
  const status = order.fulfilment_status
  return <span className={`badge badge--${status}`}>{FULFILMENT_LABELS[status]}</span>
}
