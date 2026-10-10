import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState, type ReactNode } from 'react'
import { computeDashboard, percentChange, type Dashboard } from '../analytics/dashboard'
import { formatDayRange, formatNairaCompact, formatWeekday } from '../analytics/format'
import { FULFILMENT_LABELS, PAYMENT_LABELS } from '../orders/labels'
import { formatKobo } from '../orders/money'
import { useDb } from '../orders/useDb'
import { BreakdownBars, ColumnChart } from './charts'

/** Re-renders every minute so "today" and "this month" roll over at Lagos midnight. */
function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [])
  return now
}

export function DashboardPage() {
  const db = useDb()
  const now = useMinuteClock()
  const minute = Math.floor(now.getTime() / 60_000)
  const dashboard = useLiveQuery(
    async () => computeDashboard(await db.orders.toArray(), await db.payments.toArray(), new Date(minute * 60_000)),
    [db, minute],
  )
  const hasOrders = useLiveQuery(async () => (await db.orders.filter((o) => !o.deleted_at).count()) > 0, [db])

  if (!dashboard) return null
  if (!hasOrders) {
    return (
      <p className="empty">No orders yet. Your dashboard fills in as you record orders and payments.</p>
    )
  }
  return <DashboardView d={dashboard} />
}

function DashboardView({ d }: { d: Dashboard }) {
  const lastMonthRange = formatDayRange(d.lastMonthToDate.firstDay, d.lastMonthToDate.lastDay)

  return (
    <div className="dashboard">
      <section className="hero">
        <h2 className="hero__label">Received this month</h2>
        <p className="hero__value">{formatKobo(d.monthFigures.revenueKobo)}</p>
        <Delta current={d.monthFigures.revenueKobo} previous={d.lastMonthToDate.revenueKobo} range={lastMonthRange} />
      </section>

      <section className="tiles" aria-label="Key figures">
        <Tile label="Orders today" value={String(d.todayFigures.orders)} />
        <Tile label="Received today" value={formatNairaCompact(d.todayFigures.revenueKobo)} />
        <Tile label="Orders this month" value={String(d.monthFigures.orders)}>
          <Delta current={d.monthFigures.orders} previous={d.lastMonthToDate.orders} range={lastMonthRange} />
        </Tile>
        <Tile label="Delivered this month" value={String(d.monthFigures.delivered)}>
          <Delta current={d.monthFigures.delivered} previous={d.lastMonthToDate.delivered} range={lastMonthRange} />
        </Tile>
        <Tile label="Awaiting delivery" value={String(d.awaiting.total)}>
          <p className="tile__note">
            {d.awaiting.pending} not sent · {d.awaiting.dispatched} dispatched
          </p>
        </Tile>
        <Tile label="Customers still owe" value={formatNairaCompact(d.outstanding.kobo)}>
          <p className="tile__note">
            across {d.outstanding.orders} {d.outstanding.orders === 1 ? 'order' : 'orders'}
          </p>
        </Tile>
      </section>

      <section className="card">
        <ColumnChart
          title="Orders per day, last 14 days"
          data={d.trend.map((t) => ({
            key: t.day,
            label: formatWeekday(t.day),
            value: t.orders,
            display: `${t.orders} ${t.orders === 1 ? 'order' : 'orders'}`,
          }))}
          formatTick={(v) => String(v)}
          labelEvery={4}
          wholeNumbers
        />
      </section>

      <section className="card">
        <ColumnChart
          title="Money received per day, last 14 days"
          data={d.trend.map((t) => ({
            key: t.day,
            label: formatWeekday(t.day),
            value: t.revenueKobo,
            display: formatKobo(t.revenueKobo),
          }))}
          formatTick={(v) => formatNairaCompact(v)}
          labelEvery={4}
        />
      </section>

      <section className="card">
        <h3>This month’s orders</h3>
        <BreakdownBars
          title="Delivery"
          rows={(['pending', 'dispatched', 'delivered', 'cancelled'] as const).map((s) => ({
            label: FULFILMENT_LABELS[s],
            value: d.breakdown.fulfilment[s],
          }))}
        />
        <BreakdownBars
          title="Payment (cancelled orders left out)"
          rows={(['unpaid', 'part-paid', 'paid'] as const).map((s) => ({
            label: PAYMENT_LABELS[s],
            value: d.breakdown.payment[s],
          }))}
        />
      </section>

      {/* <p className="muted small dashboard__note">
        Figures use Lagos time and are calculated on this phone from your saved orders and payments.
      </p> */}
    </div>
  )
}

function Tile({ label, value, children }: { label: string; value: string; children?: ReactNode }) {
  return (
    <div className="tile">
      <h3 className="tile__label">{label}</h3>
      <p className="tile__value">{value}</p>
      {children}
    </div>
  )
}

/** Change against the same days of last month. Arrow and words carry the direction, not colour alone. */
function Delta({ current, previous, range }: { current: number; previous: number; range: string }) {
  const change = percentChange(current, previous)
  if (change === null) {
    return <p className="delta delta--flat">{current === 0 ? `None on ${range} either` : `Nothing on ${range}`}</p>
  }
  if (change === 0) return <p className="delta delta--flat">Same as {range}</p>
  const up = change > 0
  return (
    <p className={up ? 'delta delta--up' : 'delta delta--down'}>
      <span aria-hidden="true">{up ? '▲' : '▼'}</span> {up ? 'Up' : 'Down'} {Math.abs(change)}% on {range}
    </p>
  )
}
