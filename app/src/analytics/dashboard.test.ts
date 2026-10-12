import { describe, expect, it } from 'vitest'
import type { Order } from '../orders/types'
import type { Payment } from '../payments/types'
import { MAX_TREND_DAYS, TREND_DAYS, computeDashboard, percentChange } from './dashboard'
import { addDays } from './time'

// 10 Oct 2026, 3:00 pm in Lagos.
const NOW = new Date('2026-10-10T14:00:00.000Z')

let seq = 0
function order(overrides: Partial<Order> = {}): Order {
  const created = overrides.created_at ?? '2026-10-10T09:00:00.000Z'
  return {
    id: `o${++seq}`,
    customer_name: 'Customer',
    customer_phone: null,
    channel: 'whatsapp',
    items: 'Item',
    amount_due_kobo: 1_000_000,
    fulfilment_status: 'pending',
    delivered_at: null,
    delivery_address: null,
    notes: null,
    created_at: created,
    updated_at: created,
    deleted_at: null,
    synced: 1,
    ...overrides,
  }
}

function payment(o: Order, amount: number, paidAt: string, overrides: Partial<Payment> = {}): Payment {
  return {
    id: `p${++seq}`,
    order_id: o.id,
    amount_kobo: amount,
    paid_at: paidAt,
    method: null,
    note: null,
    created_at: paidAt,
    updated_at: paidAt,
    deleted_at: null,
    synced: 1,
    ...overrides,
  }
}

describe('computeDashboard', () => {
  it('is all zeros with no data, with a 14-day trend ending today', () => {
    const d = computeDashboard([], [], NOW)

    expect(d).toMatchObject({
      today: '2026-10-10',
      month: '2026-10',
      todayFigures: { orders: 0, revenueKobo: 0, delivered: 0 },
      monthFigures: { orders: 0, revenueKobo: 0, delivered: 0 },
      awaiting: { total: 0 },
      outstanding: { kobo: 0, orders: 0 },
    })
    expect(d.trend).toHaveLength(TREND_DAYS)
    expect(d.trend[0].day).toBe('2026-09-27')
    expect(d.trend.at(-1)?.day).toBe('2026-10-10')
  })

  it('counts orders by Lagos day: 00:30 Lagos is today, 23:30 Lagos is yesterday', () => {
    const d = computeDashboard(
      [order({ created_at: '2026-10-09T23:30:00.000Z' }), order({ created_at: '2026-10-09T22:30:00.000Z' })],
      [],
      NOW,
    )
    expect(d.todayFigures.orders).toBe(1)
    expect(d.trend.at(-2)).toMatchObject({ day: '2026-10-09', orders: 1 })
    expect(d.monthFigures.orders).toBe(2)
  })

  it('leaves out cancelled and deleted orders from order counts', () => {
    const d = computeDashboard(
      [order(), order({ fulfilment_status: 'cancelled' }), order({ deleted_at: '2026-10-10T10:00:00.000Z' })],
      [],
      NOW,
    )
    expect(d.todayFigures.orders).toBe(1)
    expect(d.breakdown.fulfilment).toEqual({ pending: 1, dispatched: 0, delivered: 0, cancelled: 1 })
  })

  it('counts revenue by when money was received, not when the order was made', () => {
    const septemberOrder = order({ created_at: '2026-09-20T09:00:00.000Z' })
    const d = computeDashboard(
      [septemberOrder],
      [
        payment(septemberOrder, 300_000, '2026-09-25T09:00:00.000Z'), // September
        payment(septemberOrder, 500_000, '2026-10-02T09:00:00.000Z'), // October
        payment(septemberOrder, 200_000, '2026-09-30T23:30:00.000Z'), // 00:30 on 1 Oct in Lagos
      ],
      NOW,
    )
    expect(d.monthFigures.revenueKobo).toBe(700_000)
    expect(d.monthFigures.orders).toBe(0) // the order itself was September's
  })

  it('leaves out voided payments and payments on deleted orders; keeps those on cancelled orders', () => {
    const live = order()
    const cancelled = order({ fulfilment_status: 'cancelled' })
    const deleted = order({ deleted_at: '2026-10-10T10:00:00.000Z' })
    const d = computeDashboard(
      [live, cancelled, deleted],
      [
        payment(live, 100_000, '2026-10-10T10:00:00.000Z'),
        payment(live, 900_000, '2026-10-10T10:00:00.000Z', { deleted_at: '2026-10-10T11:00:00.000Z' }),
        payment(cancelled, 50_000, '2026-10-10T10:00:00.000Z'),
        payment(deleted, 70_000, '2026-10-10T10:00:00.000Z'),
      ],
      NOW,
    )
    expect(d.todayFigures.revenueKobo).toBe(150_000)
  })

  it('counts deliveries by delivered_at, only while the order is still delivered', () => {
    const d = computeDashboard(
      [
        order({ fulfilment_status: 'delivered', delivered_at: '2026-10-10T08:00:00.000Z' }),
        order({ fulfilment_status: 'delivered', delivered_at: '2026-10-03T08:00:00.000Z' }),
        order({ fulfilment_status: 'delivered', delivered_at: '2026-09-28T08:00:00.000Z' }), // last month
        order({ fulfilment_status: 'pending', delivered_at: null }), // reopened
      ],
      [],
      NOW,
    )
    expect(d.todayFigures.delivered).toBe(1)
    expect(d.monthFigures.delivered).toBe(2)
  })

  it('counts orders awaiting delivery of any age', () => {
    const d = computeDashboard(
      [
        order({ created_at: '2026-08-01T09:00:00.000Z' }),
        order({ fulfilment_status: 'dispatched' }),
        order({ fulfilment_status: 'delivered', delivered_at: '2026-10-10T08:00:00.000Z' }),
        order({ fulfilment_status: 'cancelled' }),
      ],
      [],
      NOW,
    )
    expect(d.awaiting).toEqual({ pending: 1, dispatched: 1, total: 2 })
  })

  it('totals what customers still owe, ignoring cancelled orders and overpayments', () => {
    const partPaid = order({ amount_due_kobo: 1_000_000 })
    const overpaid = order({ amount_due_kobo: 500_000 })
    const d = computeDashboard(
      [partPaid, overpaid, order({ amount_due_kobo: 200_000 }), order({ amount_due_kobo: 900_000, fulfilment_status: 'cancelled' })],
      [payment(partPaid, 400_000, '2026-10-10T10:00:00.000Z'), payment(overpaid, 800_000, '2026-10-10T10:00:00.000Z')],
      NOW,
    )
    expect(d.outstanding).toEqual({ kobo: 600_000 + 200_000, orders: 2 })
  })

  it('compares this month with the same days of last month', () => {
    const d = computeDashboard(
      [
        order({ created_at: '2026-09-05T09:00:00.000Z' }),
        order({ created_at: '2026-09-10T20:00:00.000Z' }), // 9 pm on the 10th: inside
        order({ created_at: '2026-09-15T09:00:00.000Z' }), // after the 10th: outside
        order({ created_at: '2026-10-02T09:00:00.000Z' }),
      ],
      [],
      NOW,
    )
    expect(d.lastMonthToDate).toMatchObject({ firstDay: '2026-09-01', lastDay: '2026-09-10', orders: 2 })
    expect(d.monthFigures.orders).toBe(1)
  })

  it('clamps the comparison to a shorter previous month', () => {
    const d = computeDashboard([], [], new Date('2026-03-31T12:00:00.000Z'))
    expect(d.lastMonthToDate).toMatchObject({ firstDay: '2026-02-01', lastDay: '2026-02-28' })
  })

  it('builds a daily trend of orders and revenue', () => {
    const o = order({ created_at: '2026-10-08T09:00:00.000Z' })
    const d = computeDashboard([o], [payment(o, 250_000, '2026-10-09T09:00:00.000Z')], NOW)
    expect(d.trend.slice(-3)).toEqual([
      { day: '2026-10-08', orders: 1, revenueKobo: 0, delivered: 0 },
      { day: '2026-10-09', orders: 0, revenueKobo: 250_000, delivered: 0 },
      { day: '2026-10-10', orders: 0, revenueKobo: 0, delivered: 0 },
    ])
  })

  it('builds the trend for a chosen range, including deliveries', () => {
    const o = order({
      created_at: '2026-10-01T09:00:00.000Z',
      fulfilment_status: 'delivered',
      delivered_at: '2026-10-02T09:00:00.000Z',
    })
    const paid = payment(o, 250_000, '2026-10-03T09:00:00.000Z')
    const d = computeDashboard([o], [paid], NOW, { first: '2026-10-01', last: '2026-10-03' })
    expect(d.trend).toEqual([
      { day: '2026-10-01', orders: 1, revenueKobo: 0, delivered: 0 },
      { day: '2026-10-02', orders: 0, revenueKobo: 0, delivered: 1 },
      { day: '2026-10-03', orders: 0, revenueKobo: 250_000, delivered: 0 },
    ])
    expect(d.monthFigures).toEqual(computeDashboard([o], [paid], NOW).monthFigures)
  })

  it('puts a backwards range in order and stops a future end on today', () => {
    const d = computeDashboard([], [], NOW, { first: '2026-12-01', last: '2026-10-08' })
    expect(d.trend.map((t) => t.day)).toEqual(['2026-10-08', '2026-10-09', '2026-10-10'])
  })

  it('shortens a range longer than a year, ending today', () => {
    const d = computeDashboard([], [], NOW, { first: '2020-01-01', last: '2026-12-01' })
    expect(d.trend).toHaveLength(MAX_TREND_DAYS)
    expect(d.trend[0].day).toBe(addDays('2026-10-10', -(MAX_TREND_DAYS - 1)))
    expect(d.trend.at(-1)?.day).toBe('2026-10-10')
  })

  it('keeps the 14-day default when the range is not a calendar day', () => {
    const d = computeDashboard([], [], NOW, { first: 'nope', last: '2026-10-01' })
    expect(d.trend).toHaveLength(TREND_DAYS)
    expect(d.trend[0].day).toBe('2026-09-27')
  })

  it('breaks this month’s orders down by payment status (cancelled left out)', () => {
    const paid = order({ amount_due_kobo: 100_000 })
    const part = order({ amount_due_kobo: 100_000 })
    const d = computeDashboard(
      [paid, part, order(), order({ fulfilment_status: 'cancelled' }), order({ created_at: '2026-09-01T09:00:00.000Z' })],
      [payment(paid, 100_000, '2026-10-10T10:00:00.000Z'), payment(part, 40_000, '2026-10-10T10:00:00.000Z')],
      NOW,
    )
    expect(d.breakdown.payment).toEqual({ unpaid: 1, 'part-paid': 1, paid: 1 })
  })
})

describe('percentChange', () => {
  it('compares with the previous figure', () => {
    expect(percentChange(150, 100)).toBe(50)
    expect(percentChange(50, 100)).toBe(-50)
    expect(percentChange(100, 100)).toBe(0)
  })

  it('has no percentage when the previous figure is 0', () => {
    expect(percentChange(5, 0)).toBeNull()
  })
})
