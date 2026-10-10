import type { OrderDb } from '../orders/db'
import { OrderNotFoundError, createOrder, nextUpdatedAt } from '../orders/repository'
import type { NewOrderInput, Order } from '../orders/types'
import type { NewPaymentInput, Payment } from './types'
import { validatePayment, type PaymentErrors } from './validation'

// All payment reads and writes go through here. Each payment is its own record,
// so payments recorded on two devices at the same time both survive sync.
// "Paid" for an order is the sum of its payments that aren't voided; it is
// never stored (BUILD_PLAN.md D16).

export class PaymentValidationError extends Error {
  readonly errors: PaymentErrors

  constructor(errors: PaymentErrors) {
    super(`Invalid payment: ${Object.keys(errors).join(', ')}`)
    this.name = 'PaymentValidationError'
    this.errors = errors
  }
}

export class PaymentNotFoundError extends Error {
  constructor(id: string) {
    super(`Payment not found: ${id}`)
    this.name = 'PaymentNotFoundError'
  }
}

/** Records a payment for an existing, non-deleted order. */
export async function addPayment(db: OrderDb, input: NewPaymentInput, now = new Date()): Promise<Payment> {
  return db.transaction('rw', db.orders, db.payments, async () => {
    const order = await db.orders.get(input.order_id)
    if (!order || order.deleted_at) throw new OrderNotFoundError(input.order_id)

    const timestamp = now.toISOString()
    const payment: Payment = {
      id: crypto.randomUUID(),
      order_id: order.id,
      amount_kobo: input.amount_kobo,
      paid_at: normaliseTime(input.paid_at) ?? timestamp,
      method: input.method ?? null,
      note: input.note?.trim() || null,
      created_at: timestamp,
      updated_at: timestamp,
      deleted_at: null,
      synced: 0,
      sync_error: null,
    }
    const errors = validatePayment(payment, now)
    if (Object.keys(errors).length > 0) throw new PaymentValidationError(errors)

    await db.payments.add(payment)
    return payment
  })
}

/** Voids a payment (also how refunds are recorded). Kept as a record so the change syncs. */
export async function voidPayment(db: OrderDb, id: string, now = new Date()): Promise<void> {
  await db.transaction('rw', db.payments, async () => {
    const payment = await db.payments.get(id)
    if (!payment || payment.deleted_at) throw new PaymentNotFoundError(id)
    const updated_at = nextUpdatedAt(payment.updated_at, now)
    await db.payments.put({ ...payment, deleted_at: updated_at, updated_at, synced: 0, sync_error: null })
  })
}

/** An order's payments that aren't voided, most recent first. */
export async function paymentsForOrder(db: OrderDb, orderId: string): Promise<Payment[]> {
  const payments = await db.payments
    .where('order_id')
    .equals(orderId)
    .filter((p) => !p.deleted_at)
    .toArray()
  return payments.sort((a, b) => b.paid_at.localeCompare(a.paid_at) || b.created_at.localeCompare(a.created_at))
}

/** Total received for one order, in kobo. */
export async function paidTotal(db: OrderDb, orderId: string): Promise<number> {
  return sum(await paymentsForOrder(db, orderId))
}

/** Total received per order id, in kobo (orders without payments are absent: treat as 0). */
export async function paidTotals(db: OrderDb): Promise<Map<string, number>> {
  const totals = new Map<string, number>()
  await db.payments
    .filter((p) => !p.deleted_at)
    .each((p) => totals.set(p.order_id, (totals.get(p.order_id) ?? 0) + p.amount_kobo))
  return totals
}

/** Records a part payment received now (or at `paid_at`). */
export function recordPayment(
  db: OrderDb,
  orderId: string,
  amountKobo: number,
  details: Omit<NewPaymentInput, 'order_id' | 'amount_kobo'> = {},
  now = new Date(),
): Promise<Payment> {
  return addPayment(db, { ...details, order_id: orderId, amount_kobo: amountKobo }, now)
}

/**
 * Records a payment for whatever is still owed. Returns null (records nothing)
 * when the order is already fully paid or overpaid.
 */
export async function markFullyPaid(db: OrderDb, orderId: string, now = new Date()): Promise<Payment | null> {
  return db.transaction('rw', db.orders, db.payments, async () => {
    const order = await db.orders.get(orderId)
    if (!order || order.deleted_at) throw new OrderNotFoundError(orderId)
    const owed = order.amount_due_kobo - (await paidTotal(db, orderId))
    if (owed <= 0) return null
    return addPayment(db, { order_id: orderId, amount_kobo: owed }, now)
  })
}

/**
 * Creates an order and, if something was already paid, its first payment, in
 * one transaction: if either is invalid, neither is saved.
 */
export async function createOrderWithPayment(
  db: OrderDb,
  input: NewOrderInput,
  alreadyPaidKobo: number,
  now = new Date(),
): Promise<Order> {
  return db.transaction('rw', db.orders, db.payments, async () => {
    const order = await createOrder(db, input, now)
    if (alreadyPaidKobo > 0) await addPayment(db, { order_id: order.id, amount_kobo: alreadyPaidKobo }, now)
    return order
  })
}

function sum(payments: Payment[]): number {
  return payments.reduce((total, p) => total + p.amount_kobo, 0)
}

function normaliseTime(value: string | undefined): string | null {
  if (!value) return null
  const time = Date.parse(value)
  return Number.isNaN(time) ? value : new Date(time).toISOString()
}
