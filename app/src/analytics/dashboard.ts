import { paymentStatus } from '../orders/payment'
import type { FulfilmentStatus, Order, PaymentStatus } from '../orders/types'
import type { Payment } from '../payments/types'
import {
  addDays,
  dayOfMonth,
  inDays,
  inclusiveDayCount,
  isDayKey,
  lagosDay,
  lagosMonth,
  previousMonth,
  type DayKey,
  type MonthKey,
} from './time'

// Dashboard figures, calculated on the device from local data (works offline).
// Definitions (BUILD_PLAN.md D19):
// - "orders" = orders created in the period, excluding deleted and cancelled
// - revenue = payments by paid_at, excluding voided payments and payments on
//   deleted orders; payments on cancelled orders count until voided (D16)
// - delivered = orders currently delivered whose delivered_at is in the period
// - outstanding = what is still owed on orders that aren't deleted or cancelled
// - all periods are Lagos calendar days/months

export const TREND_DAYS = 14
/** Longest daily report, so a custom range can't walk years of empty days. */
export const MAX_TREND_DAYS = 366

export interface PeriodFigures {
  orders: number
  revenueKobo: number
  delivered: number
}

export interface TrendRange {
  first: DayKey
  last: DayKey
}

export interface TrendPoint {
  day: DayKey
  orders: number
  revenueKobo: number
  delivered: number
}

/** The last TREND_DAYS Lagos days, ending on `today`. */
export function defaultTrendRange(today: DayKey): TrendRange {
  return { first: addDays(today, -(TREND_DAYS - 1)), last: today }
}

/** In order, ending no later than `today`, and no longer than MAX_TREND_DAYS. */
export function clampTrendRange(range: TrendRange, today: DayKey): TrendRange {
  let first = range.first
  let last = range.last
  if (first > last) [first, last] = [last, first]
  if (last > today) last = today
  if (first > last) first = last
  if (inclusiveDayCount(first, last) > MAX_TREND_DAYS) first = addDays(last, -(MAX_TREND_DAYS - 1))
  return { first, last }
}

function resolveTrendRange(today: DayKey, range?: TrendRange): TrendRange {
  if (!range || !isDayKey(range.first) || !isDayKey(range.last)) return defaultTrendRange(today)
  return clampTrendRange(range, today)
}

export interface Dashboard {
  today: DayKey
  month: MonthKey
  /** Today so far. */
  todayFigures: PeriodFigures
  /** This month so far (1st to today). */
  monthFigures: PeriodFigures
  /** The same days of last month (1st to the same day number, clamped to its length). */
  lastMonthToDate: PeriodFigures & { firstDay: DayKey; lastDay: DayKey }
  /** Orders not yet delivered or cancelled, of any age. */
  awaiting: { pending: number; dispatched: number; total: number }
  /** Still owed on orders that aren't cancelled. */
  outstanding: { kobo: number; orders: number }
  /** Orders, money received and deliveries per Lagos day, oldest first. Defaults to the last 14 days. */
  trend: TrendPoint[]
  /** Current status of this month's orders (cancelled included in delivery status only). */
  breakdown: {
    fulfilment: Record<FulfilmentStatus, number>
    payment: Record<PaymentStatus, number>
  }
}

export function computeDashboard(
  allOrders: readonly Order[],
  allPayments: readonly Payment[],
  now = new Date(),
  range?: TrendRange,
): Dashboard {
  const today = lagosDay(now)
  const month = lagosMonth(now)
  const firstOfMonth = `${month}-01`
  const lastMonth = previousMonth(month)
  const lastMonthFirst = `${lastMonth}-01`
  const lastMonthLast = dayOfMonth(lastMonth, Number(today.slice(8, 10)))

  const orders = allOrders.filter((o) => !o.deleted_at)
  const liveOrderIds = new Set(orders.map((o) => o.id))
  const payments = allPayments.filter((p) => !p.deleted_at && liveOrderIds.has(p.order_id))
  const received = orders.filter((o) => o.fulfilment_status !== 'cancelled')

  const paidByOrder = new Map<string, number>()
  for (const p of payments) paidByOrder.set(p.order_id, (paidByOrder.get(p.order_id) ?? 0) + p.amount_kobo)
  const paidFor = (o: Order) => paidByOrder.get(o.id) ?? 0

  function figures(first: DayKey, last: DayKey): PeriodFigures {
    return {
      orders: received.filter((o) => inDays(o.created_at, first, last)).length,
      revenueKobo: payments.filter((p) => inDays(p.paid_at, first, last)).reduce((sum, p) => sum + p.amount_kobo, 0),
      delivered: orders.filter((o) => o.fulfilment_status === 'delivered' && inDays(o.delivered_at, first, last)).length,
    }
  }

  const pending = orders.filter((o) => o.fulfilment_status === 'pending').length
  const dispatched = orders.filter((o) => o.fulfilment_status === 'dispatched').length

  let outstandingKobo = 0
  let outstandingOrders = 0
  for (const o of received) {
    const owed = o.amount_due_kobo - paidFor(o)
    if (owed > 0) {
      outstandingKobo += owed
      outstandingOrders++
    }
  }

  const trendRange = resolveTrendRange(today, range)
  const trend: TrendPoint[] = []
  for (let day = trendRange.first; day <= trendRange.last; day = addDays(day, 1)) {
    const f = figures(day, day)
    trend.push({ day, orders: f.orders, revenueKobo: f.revenueKobo, delivered: f.delivered })
  }

  const thisMonthsOrders = orders.filter((o) => inDays(o.created_at, firstOfMonth, today))
  const fulfilment: Record<FulfilmentStatus, number> = { pending: 0, dispatched: 0, delivered: 0, cancelled: 0 }
  const payment: Record<PaymentStatus, number> = { unpaid: 0, 'part-paid': 0, paid: 0 }
  for (const o of thisMonthsOrders) {
    fulfilment[o.fulfilment_status]++
    if (o.fulfilment_status !== 'cancelled') payment[paymentStatus(o.amount_due_kobo, paidFor(o))]++
  }

  return {
    today,
    month,
    todayFigures: figures(today, today),
    monthFigures: figures(firstOfMonth, today),
    lastMonthToDate: { ...figures(lastMonthFirst, lastMonthLast), firstDay: lastMonthFirst, lastDay: lastMonthLast },
    awaiting: { pending, dispatched, total: pending + dispatched },
    outstanding: { kobo: outstandingKobo, orders: outstandingOrders },
    trend,
    breakdown: { fulfilment, payment },
  }
}

/** Percentage change from `previous` to `current`, or null when there's nothing to compare against. */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null
  return Math.round(((current - previous) / previous) * 100)
}
