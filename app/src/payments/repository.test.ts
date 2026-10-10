import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openOrderDb, type OrderDb } from '../orders/db'
import { OrderNotFoundError, createOrder, deleteOrder } from '../orders/repository'
import type { NewOrderInput } from '../orders/types'
import {
  PaymentNotFoundError,
  PaymentValidationError,
  addPayment,
  createOrderWithPayment,
  markFullyPaid,
  paidTotal,
  paidTotals,
  paymentsForOrder,
  recordPayment,
  voidPayment,
} from './repository'
import { MAX_PAYMENT_KOBO } from './validation'

const T0 = new Date('2026-10-10T09:00:00.000Z')
const later = (ms: number) => new Date(T0.getTime() + ms)
const DAY = 86_400_000
const input: NewOrderInput = { customer_name: 'Ada', items: '2x Ankara gown', amount_due_kobo: 2_500_000 }

let db: OrderDb

beforeEach(async () => {
  db = openOrderDb(`payments-test-${crypto.randomUUID()}`)
  await db.open()
})

afterEach(async () => {
  await db.delete()
})

describe('addPayment', () => {
  it('records a payment received now, unsynced, with defaults', async () => {
    const order = await createOrder(db, input, T0)
    const payment = await addPayment(db, { order_id: order.id, amount_kobo: 1_000_000, note: '  first  ' }, later(1_000))

    expect(payment).toMatchObject({
      order_id: order.id,
      amount_kobo: 1_000_000,
      paid_at: later(1_000).toISOString(),
      method: null,
      note: 'first',
      created_at: later(1_000).toISOString(),
      deleted_at: null,
      synced: 0,
      sync_error: null,
    })
    expect(payment.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(await db.payments.get(payment.id)).toEqual(payment)
  })

  it('accepts a method and a backdated time up to 90 days', async () => {
    const order = await createOrder(db, input, T0)
    const paidAt = new Date(T0.getTime() - 89 * DAY).toISOString()
    const payment = await recordPayment(db, order.id, 500_000, { paid_at: paidAt, method: 'pos' }, T0)
    expect(payment).toMatchObject({ paid_at: paidAt, method: 'pos' })
  })

  it.each([
    ['zero', { amount_kobo: 0 }, 'amount_kobo'],
    ['negative', { amount_kobo: -100 }, 'amount_kobo'],
    ['fractional kobo', { amount_kobo: 10.5 }, 'amount_kobo'],
    ['over ₦1bn', { amount_kobo: MAX_PAYMENT_KOBO + 1 }, 'amount_kobo'],
    ['in the future', { paid_at: later(60 * 60_000).toISOString() }, 'paid_at'],
    ['backdated over 90 days', { paid_at: new Date(T0.getTime() - 91 * DAY).toISOString() }, 'paid_at'],
    ['not a date', { paid_at: 'yesterday-ish' }, 'paid_at'],
    ['an unknown method', { method: 'bitcoin' as never }, 'method'],
    ['a note over 500 characters', { note: 'x'.repeat(501) }, 'note'],
  ])('rejects a payment %s and saves nothing', async (_label, override, field) => {
    const order = await createOrder(db, input, T0)
    const error = await addPayment(db, { order_id: order.id, amount_kobo: 1_000, ...override }, T0).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(PaymentValidationError)
    expect(Object.keys((error as PaymentValidationError).errors)).toEqual([field])
    expect(await db.payments.count()).toBe(0)
  })

  it('allows a phone clock up to 5 minutes fast, like the server', async () => {
    const order = await createOrder(db, input, T0)
    const payment = await addPayment(db, { order_id: order.id, amount_kobo: 1_000, paid_at: later(4 * 60_000).toISOString() }, T0)
    expect(payment.paid_at).toBe(later(4 * 60_000).toISOString())
  })

  it('needs an existing order that is not deleted', async () => {
    await expect(addPayment(db, { order_id: 'missing', amount_kobo: 1_000 }, T0)).rejects.toBeInstanceOf(OrderNotFoundError)

    const order = await createOrder(db, input, T0)
    await deleteOrder(db, order.id, later(1))
    await expect(addPayment(db, { order_id: order.id, amount_kobo: 1_000 }, later(2))).rejects.toBeInstanceOf(
      OrderNotFoundError,
    )
  })
})

describe('totals', () => {
  it('adds up an order’s payments, ignoring voided ones and other orders', async () => {
    const order = await createOrder(db, input, T0)
    const other = await createOrder(db, { ...input, customer_name: 'Bayo' }, T0)
    await recordPayment(db, order.id, 1_000_000, {}, later(1))
    const mistake = await recordPayment(db, order.id, 900_000, {}, later(2))
    await recordPayment(db, order.id, 500_000, {}, later(3))
    await recordPayment(db, other.id, 200_000, {}, later(4))
    await voidPayment(db, mistake.id, later(5))

    expect(await paidTotal(db, order.id)).toBe(1_500_000)
    const totals = await paidTotals(db)
    expect(totals.get(order.id)).toBe(1_500_000)
    expect(totals.get(other.id)).toBe(200_000)
  })

  it('is 0 for an order without payments', async () => {
    const order = await createOrder(db, input, T0)
    expect(await paidTotal(db, order.id)).toBe(0)
    expect((await paidTotals(db)).has(order.id)).toBe(false)
  })

  it('lists an order’s payments most recent first, without voided ones', async () => {
    const order = await createOrder(db, input, T0)
    const older = await recordPayment(db, order.id, 1_000, { paid_at: later(-2 * DAY).toISOString() }, T0)
    const newer = await recordPayment(db, order.id, 2_000, {}, later(1))
    const voided = await recordPayment(db, order.id, 3_000, {}, later(2))
    await voidPayment(db, voided.id, later(3))

    expect((await paymentsForOrder(db, order.id)).map((p) => p.id)).toEqual([newer.id, older.id])
  })
})

describe('voidPayment', () => {
  it('keeps the payment as a voided record that syncs', async () => {
    const order = await createOrder(db, input, T0)
    const payment = await recordPayment(db, order.id, 1_000, {}, later(1))
    await db.payments.update(payment.id, { synced: 1 })

    await voidPayment(db, payment.id, later(2))

    expect(await db.payments.get(payment.id)).toMatchObject({
      deleted_at: later(2).toISOString(),
      updated_at: later(2).toISOString(),
      synced: 0,
    })
  })

  it('cannot void the same payment twice or a missing one', async () => {
    const order = await createOrder(db, input, T0)
    const payment = await recordPayment(db, order.id, 1_000, {}, later(1))
    await voidPayment(db, payment.id, later(2))

    await expect(voidPayment(db, payment.id, later(3))).rejects.toBeInstanceOf(PaymentNotFoundError)
    await expect(voidPayment(db, 'missing', later(3))).rejects.toBeInstanceOf(PaymentNotFoundError)
  })
})

describe('markFullyPaid', () => {
  it('records a payment for exactly what is still owed', async () => {
    const order = await createOrder(db, input, T0)
    await recordPayment(db, order.id, 1_000_000, {}, later(1))

    const payment = await markFullyPaid(db, order.id, later(2))

    expect(payment?.amount_kobo).toBe(1_500_000)
    expect(await paidTotal(db, order.id)).toBe(2_500_000)
  })

  it('records nothing when already paid or overpaid', async () => {
    const order = await createOrder(db, input, T0)
    await recordPayment(db, order.id, 3_000_000, {}, later(1))

    expect(await markFullyPaid(db, order.id, later(2))).toBeNull()
    expect(await db.payments.count()).toBe(1)
  })

  it('records nothing for a ₦0 order', async () => {
    const order = await createOrder(db, { ...input, amount_due_kobo: 0 }, T0)
    expect(await markFullyPaid(db, order.id, later(1))).toBeNull()
  })

  it('needs an existing order', async () => {
    await expect(markFullyPaid(db, 'missing', T0)).rejects.toBeInstanceOf(OrderNotFoundError)
  })
})

describe('createOrderWithPayment', () => {
  it('creates the order and its first payment', async () => {
    const order = await createOrderWithPayment(db, input, 1_000_000, T0)

    expect(await db.orders.get(order.id)).toBeDefined()
    expect(await paidTotal(db, order.id)).toBe(1_000_000)
  })

  it('creates no payment when nothing was paid', async () => {
    await createOrderWithPayment(db, input, 0, T0)
    expect(await db.payments.count()).toBe(0)
  })

  it('saves neither if the payment is invalid', async () => {
    await expect(createOrderWithPayment(db, input, MAX_PAYMENT_KOBO + 1, T0)).rejects.toBeInstanceOf(
      PaymentValidationError,
    )
    expect(await db.orders.count()).toBe(0)
    expect(await db.payments.count()).toBe(0)
  })
})
