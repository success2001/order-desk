import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openOrderDb, releaseOrderDb, type OrderDb } from './db'
import {
  OrderNotFoundError,
  OrderValidationError,
  createOrder,
  deleteOrder,
  getOrder,
  listOrders,
  markFullyPaid,
  nextUpdatedAt,
  recordPayment,
  setFulfilmentStatus,
  updateOrder,
} from './repository'
import type { NewOrderInput } from './types'

const T0 = new Date('2026-10-10T09:00:00.000Z')
const later = (ms: number) => new Date(T0.getTime() + ms)

const input: NewOrderInput = {
  customer_name: '  Ada  ',
  items: '2x Ankara gown (L)',
  amount_due_kobo: 2_500_000,
}

let db: OrderDb

beforeEach(async () => {
  db = openOrderDb(`test-${crypto.randomUUID()}`)
  await db.open()
})

afterEach(async () => {
  await db.delete()
})

describe('createOrder', () => {
  it('saves a new order with defaults, trimmed text and unsynced flag', async () => {
    const order = await createOrder(db, input, T0)

    expect(order).toMatchObject({
      customer_name: 'Ada',
      customer_phone: null,
      channel: 'whatsapp',
      amount_paid_kobo: 0,
      fulfilment_status: 'pending',
      notes: null,
      created_at: T0.toISOString(),
      updated_at: T0.toISOString(),
      deleted_at: null,
      synced: 0,
    })
    expect(order.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(await db.orders.get(order.id)).toEqual(order)
  })

  it('stores blank optional text as null', async () => {
    const order = await createOrder(db, { ...input, customer_phone: '   ', notes: '' }, T0)
    expect(order.customer_phone).toBeNull()
    expect(order.notes).toBeNull()
  })

  it('rejects invalid input and saves nothing', async () => {
    const bad = { ...input, customer_name: ' ', items: '', amount_due_kobo: -1 }
    const error = await createOrder(db, bad, T0).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(OrderValidationError)
    expect(Object.keys((error as OrderValidationError).errors).sort()).toEqual([
      'amount_due_kobo',
      'customer_name',
      'items',
    ])
    expect(await db.orders.count()).toBe(0)
  })

  it('rejects fractional kobo', async () => {
    await expect(createOrder(db, { ...input, amount_due_kobo: 100.5 }, T0)).rejects.toBeInstanceOf(
      OrderValidationError,
    )
  })
})

describe('updating orders', () => {
  it('applies changes, bumps updated_at and marks the order unsynced', async () => {
    const order = await createOrder(db, input, T0)
    await db.orders.update(order.id, { synced: 1 }) // pretend it was synced

    const updated = await updateOrder(db, order.id, { items: '3x Ankara gown (L)' }, later(60_000))

    expect(updated.items).toBe('3x Ankara gown (L)')
    expect(updated.updated_at).toBe(later(60_000).toISOString())
    expect(updated.created_at).toBe(T0.toISOString())
    expect(updated.synced).toBe(0)
  })

  it('cannot change id or created_at through updateOrder', async () => {
    const order = await createOrder(db, input, T0)
    const sneaky = { id: 'other', created_at: '2000-01-01T00:00:00.000Z' } as never
    const updated = await updateOrder(db, order.id, sneaky, later(1))

    expect(updated.id).toBe(order.id)
    expect(updated.created_at).toBe(order.created_at)
  })

  it('rejects invalid changes and leaves the stored order untouched', async () => {
    const order = await createOrder(db, input, T0)
    await expect(updateOrder(db, order.id, { customer_name: '' }, later(1))).rejects.toBeInstanceOf(
      OrderValidationError,
    )
    expect(await db.orders.get(order.id)).toEqual(order)
  })

  it('records part payments cumulatively', async () => {
    const order = await createOrder(db, input, T0)
    await recordPayment(db, order.id, 1_000_000, later(1))
    const updated = await recordPayment(db, order.id, 500_000, later(2))
    expect(updated.amount_paid_kobo).toBe(1_500_000)
  })

  it('rejects zero, negative or fractional payments', async () => {
    const order = await createOrder(db, input, T0)
    for (const amount of [0, -100, 10.5]) {
      await expect(recordPayment(db, order.id, amount, later(1))).rejects.toBeInstanceOf(OrderValidationError)
    }
  })

  it('marks fully paid without reducing an overpayment', async () => {
    const order = await createOrder(db, input, T0)
    expect((await markFullyPaid(db, order.id, later(1))).amount_paid_kobo).toBe(2_500_000)

    await recordPayment(db, order.id, 100_000, later(2)) // now overpaid
    expect((await markFullyPaid(db, order.id, later(3))).amount_paid_kobo).toBe(2_600_000)
  })

  it('sets fulfilment status', async () => {
    const order = await createOrder(db, input, T0)
    expect((await setFulfilmentStatus(db, order.id, 'dispatched', later(1))).fulfilment_status).toBe('dispatched')
  })

  it('throws OrderNotFoundError for unknown or deleted orders', async () => {
    await expect(updateOrder(db, 'missing', { items: 'x' }, T0)).rejects.toBeInstanceOf(OrderNotFoundError)

    const order = await createOrder(db, input, T0)
    await deleteOrder(db, order.id, later(1))
    await expect(markFullyPaid(db, order.id, later(2))).rejects.toBeInstanceOf(OrderNotFoundError)
  })
})

describe('clock going backwards', () => {
  it('still moves updated_at forward so the server accepts the change', async () => {
    const order = await createOrder(db, input, T0)
    const updated = await updateOrder(db, order.id, { items: 'changed' }, later(-3_600_000)) // phone clock 1h behind

    expect(Date.parse(updated.updated_at)).toBeGreaterThan(Date.parse(order.updated_at))
  })

  it('nextUpdatedAt uses now when it is later, otherwise previous + 1 ms', () => {
    const prev = T0.toISOString()
    expect(nextUpdatedAt(prev, later(5_000))).toBe(later(5_000).toISOString())
    expect(nextUpdatedAt(prev, T0)).toBe(later(1).toISOString())
    expect(nextUpdatedAt(prev, later(-10_000))).toBe(later(1).toISOString())
  })
})

describe('deleteOrder', () => {
  it('soft-deletes: hidden from reads but kept, unsynced, for sync', async () => {
    const order = await createOrder(db, input, T0)
    await db.orders.update(order.id, { synced: 1 })
    await deleteOrder(db, order.id, later(1))

    expect(await getOrder(db, order.id)).toBeUndefined()
    expect(await listOrders(db, { includeCompleted: true })).toEqual([])

    const stored = await db.orders.get(order.id)
    expect(stored?.deleted_at).toBe(later(1).toISOString())
    expect(stored?.updated_at).toBe(later(1).toISOString())
    expect(stored?.synced).toBe(0)
  })

  it('cannot delete the same order twice', async () => {
    const order = await createOrder(db, input, T0)
    await deleteOrder(db, order.id, later(1))
    await expect(deleteOrder(db, order.id, later(2))).rejects.toBeInstanceOf(OrderNotFoundError)
  })
})

describe('listOrders', () => {
  it('lists open orders newest first and hides completed ones by default', async () => {
    const first = await createOrder(db, { ...input, customer_name: 'First' }, T0)
    const second = await createOrder(db, { ...input, customer_name: 'Second' }, later(1_000))
    const delivered = await createOrder(db, { ...input, customer_name: 'Delivered' }, later(2_000))
    const cancelled = await createOrder(db, { ...input, customer_name: 'Cancelled' }, later(3_000))
    await setFulfilmentStatus(db, delivered.id, 'delivered', later(4_000))
    await setFulfilmentStatus(db, cancelled.id, 'cancelled', later(5_000))

    const open = await listOrders(db)
    expect(open.map((o) => o.id)).toEqual([second.id, first.id])

    const all = await listOrders(db, { includeCompleted: true })
    expect(all.map((o) => o.customer_name)).toEqual(['Cancelled', 'Delivered', 'Second', 'First'])
  })

  it('keeps dispatched orders in the open list', async () => {
    const order = await createOrder(db, input, T0)
    await setFulfilmentStatus(db, order.id, 'dispatched', later(1))
    expect((await listOrders(db)).map((o) => o.id)).toEqual([order.id])
  })
})

describe('delivered_at', () => {
  it('is null for a new order that is not delivered', async () => {
    expect((await createOrder(db, input, T0)).delivered_at).toBeNull()
  })

  it('is the creation time for an order created as delivered', async () => {
    const order = await createOrder(db, { ...input, fulfilment_status: 'delivered' }, T0)
    expect(order.delivered_at).toBe(T0.toISOString())
  })

  it('is set to the time the order becomes delivered', async () => {
    const order = await createOrder(db, input, T0)
    await setFulfilmentStatus(db, order.id, 'dispatched', later(1_000))
    const delivered = await setFulfilmentStatus(db, order.id, 'delivered', later(2_000))
    expect(delivered.delivered_at).toBe(later(2_000).toISOString())
  })

  it('stays unchanged when a delivered order is edited or marked delivered again', async () => {
    const order = await createOrder(db, input, T0)
    await setFulfilmentStatus(db, order.id, 'delivered', later(1_000))
    await updateOrder(db, order.id, { items: 'edited after delivery' }, later(2_000))
    await recordPayment(db, order.id, 100_000, later(3_000))
    const again = await setFulfilmentStatus(db, order.id, 'delivered', later(4_000))
    expect(again.delivered_at).toBe(later(1_000).toISOString())
  })

  it.each(['pending', 'dispatched', 'cancelled'] as const)('is cleared when a delivered order becomes %s', async (status) => {
    const order = await createOrder(db, input, T0)
    await setFulfilmentStatus(db, order.id, 'delivered', later(1_000))
    expect((await setFulfilmentStatus(db, order.id, status, later(2_000))).delivered_at).toBeNull()
  })

  it('gets a new time when delivered again after being reopened', async () => {
    const order = await createOrder(db, input, T0)
    await setFulfilmentStatus(db, order.id, 'delivered', later(1_000))
    await setFulfilmentStatus(db, order.id, 'pending', later(2_000))
    const redelivered = await setFulfilmentStatus(db, order.id, 'delivered', later(3_000))
    expect(redelivered.delivered_at).toBe(later(3_000).toISOString())
  })

  it('matches updated_at even when the phone clock has gone backwards', async () => {
    const order = await createOrder(db, input, T0)
    const delivered = await setFulfilmentStatus(db, order.id, 'delivered', later(-60_000))
    expect(delivered.delivered_at).toBe(delivered.updated_at)
    expect(Date.parse(delivered.delivered_at!)).toBeGreaterThan(Date.parse(order.updated_at))
  })

  it('cannot be set directly through updateOrder', async () => {
    const order = await createOrder(db, input, T0)
    const sneaky = { delivered_at: '2020-01-01T00:00:00.000Z' } as never
    expect((await updateOrder(db, order.id, sneaky, later(1))).delivered_at).toBeNull()
  })
})

describe('database upgrade to version 2', () => {
  it('fills delivered_at for orders saved before it existed', async () => {
    const name = `upgrade-${crypto.randomUUID()}`
    const v1 = new Dexie(name)
    v1.version(1).stores({ orders: 'id, created_at, updated_at, synced, fulfilment_status', meta: 'key' })
    const base = { customer_phone: null, channel: 'whatsapp', items: 'x', amount_due_kobo: 1, amount_paid_kobo: 0, notes: null, created_at: T0.toISOString(), deleted_at: null, synced: 1 }
    await v1.table('orders').bulkAdd([
      { ...base, id: 'delivered', customer_name: 'A', fulfilment_status: 'delivered', updated_at: later(5_000).toISOString() },
      { ...base, id: 'pending', customer_name: 'B', fulfilment_status: 'pending', updated_at: later(6_000).toISOString() },
    ])
    v1.close()

    const v2 = openOrderDb(name)
    expect((await v2.orders.get('delivered'))?.delivered_at).toBe(later(5_000).toISOString())
    expect((await v2.orders.get('pending'))?.delivered_at).toBeNull()
    expect(await v2.orders.where('delivered_at').above('').count()).toBe(1) // new index works
    expect((await v2.orders.get('delivered'))?.synced).toBe(1) // upgrade doesn't force a re-send
    await v2.delete()
  })
})

describe('releasing the database', () => {
  it('can still save after release (remounts, e.g. React StrictMode in development)', async () => {
    await createOrder(db, input, T0)
    releaseOrderDb(db)

    const second = await createOrder(db, { ...input, customer_name: 'After release' }, later(1))
    expect(await getOrder(db, second.id)).toMatchObject({ customer_name: 'After release' })
    expect(await db.orders.count()).toBe(2)
  })
})

describe('separate databases per vendor', () => {
  it('does not share orders between databases', async () => {
    const other = openOrderDb(`test-${crypto.randomUUID()}`)
    await createOrder(db, input, T0)
    expect(await listOrders(other)).toEqual([])
    await other.delete()
  })
})
