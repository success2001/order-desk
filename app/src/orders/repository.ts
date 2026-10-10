import type { OrderDb } from './db'
import type { FulfilmentStatus, NewOrderInput, Order, OrderChanges } from './types'
import { validateOrder, type ValidationErrors } from './validation'

// All order reads and writes go through here. Every write saves to the device
// first and marks the order unsynced (synced = 0, no sync_error) for the sync engine.

export class OrderValidationError extends Error {
  readonly errors: ValidationErrors

  constructor(errors: ValidationErrors) {
    super(`Invalid order: ${Object.keys(errors).join(', ')}`)
    this.name = 'OrderValidationError'
    this.errors = errors
  }
}

export class OrderNotFoundError extends Error {
  constructor(id: string) {
    super(`Order not found: ${id}`)
    this.name = 'OrderNotFoundError'
  }
}

const COMPLETED: readonly FulfilmentStatus[] = ['delivered', 'cancelled']

export async function createOrder(db: OrderDb, input: NewOrderInput, now = new Date()): Promise<Order> {
  const timestamp = now.toISOString()
  const order: Order = normalise({
    id: crypto.randomUUID(),
    customer_name: input.customer_name,
    customer_phone: input.customer_phone ?? null,
    channel: input.channel ?? 'whatsapp',
    items: input.items,
    amount_due_kobo: input.amount_due_kobo,
    amount_paid_kobo: input.amount_paid_kobo ?? 0,
    fulfilment_status: input.fulfilment_status ?? 'pending',
    notes: input.notes ?? null,
    created_at: timestamp,
    updated_at: timestamp,
    deleted_at: null,
    synced: 0,
    sync_error: null,
  })
  assertValid(order)
  await db.orders.add(order)
  return order
}

export function updateOrder(db: OrderDb, id: string, changes: OrderChanges, now = new Date()): Promise<Order> {
  return modify(db, id, now, () => changes)
}

/** Adds a payment to what has already been received. */
export function recordPayment(db: OrderDb, id: string, amountKobo: number, now = new Date()): Promise<Order> {
  if (!Number.isSafeInteger(amountKobo) || amountKobo <= 0) {
    return Promise.reject(new OrderValidationError({ amount_paid_kobo: 'Enter a payment greater than ₦0.' }))
  }
  return modify(db, id, now, (o) => ({ amount_paid_kobo: o.amount_paid_kobo + amountKobo }))
}

/** Sets the amount received to the full amount due. Leaves overpayments as they are. */
export function markFullyPaid(db: OrderDb, id: string, now = new Date()): Promise<Order> {
  return modify(db, id, now, (o) => ({ amount_paid_kobo: Math.max(o.amount_paid_kobo, o.amount_due_kobo) }))
}

export function setFulfilmentStatus(db: OrderDb, id: string, status: FulfilmentStatus, now = new Date()): Promise<Order> {
  return modify(db, id, now, () => ({ fulfilment_status: status }))
}

/** Soft delete: the order disappears from the app but the deletion still syncs. */
export async function deleteOrder(db: OrderDb, id: string, now = new Date()): Promise<void> {
  await db.transaction('rw', db.orders, async () => {
    const existing = await db.orders.get(id)
    if (!existing || existing.deleted_at) throw new OrderNotFoundError(id)
    const updated_at = nextUpdatedAt(existing.updated_at, now)
    await db.orders.put({ ...existing, deleted_at: updated_at, updated_at, synced: 0, sync_error: null })
  })
}

export async function getOrder(db: OrderDb, id: string): Promise<Order | undefined> {
  const order = await db.orders.get(id)
  return order && !order.deleted_at ? order : undefined
}

/** Newest first. By default only open orders (not delivered or cancelled). */
export async function listOrders(db: OrderDb, { includeCompleted = false } = {}): Promise<Order[]> {
  const orders = await db.orders
    .orderBy('created_at')
    .reverse()
    .filter((o) => !o.deleted_at && (includeCompleted || !COMPLETED.includes(o.fulfilment_status)))
    .toArray()
  return orders
}

async function modify(
  db: OrderDb,
  id: string,
  now: Date,
  change: (existing: Order) => OrderChanges,
): Promise<Order> {
  return db.transaction('rw', db.orders, async () => {
    const existing = await db.orders.get(id)
    if (!existing || existing.deleted_at) throw new OrderNotFoundError(id)

    const updated: Order = normalise({
      ...existing,
      ...change(existing),
      // Identity and bookkeeping fields cannot be overridden by changes.
      id: existing.id,
      created_at: existing.created_at,
      deleted_at: existing.deleted_at,
      updated_at: nextUpdatedAt(existing.updated_at, now),
      // A new local change gets a fresh attempt, even if the previous one was rejected.
      synced: 0,
      sync_error: null,
    })
    assertValid(updated)
    await db.orders.put(updated)
    return updated
  })
}

/**
 * The new updated_at must be later than the previous one, or the server would
 * treat the change as stale. If the phone clock has gone backwards, step 1 ms past the last change.
 */
export function nextUpdatedAt(previous: string, now: Date): string {
  const prev = Date.parse(previous)
  return new Date(Math.max(now.getTime(), prev + 1)).toISOString()
}

function normalise(order: Order): Order {
  return {
    ...order,
    customer_name: order.customer_name.trim(),
    customer_phone: order.customer_phone?.trim() || null,
    items: order.items.trim(),
    notes: order.notes?.trim() || null,
  }
}

function assertValid(order: Order): void {
  const errors = validateOrder(order)
  if (Object.keys(errors).length > 0) throw new OrderValidationError(errors)
}
