import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState, type ReactNode } from 'react'
import { downloadCsv, trendCsv } from '../analytics/csv'
import { clampTrendRange, computeDashboard, percentChange, type Dashboard, type TrendRange } from '../analytics/dashboard'
import { formatDayRange, formatNairaCompact, formatWeekday } from '../analytics/format'
import { addDays, isDayKey, lagosDay, type DayKey } from '../analytics/time'
import { FULFILMENT_LABELS, PAYMENT_LABELS } from '../orders/labels'
import { formatKobo } from '../orders/money'
import { useDb } from '../orders/useDb'
import { BreakdownBars, ColumnChart } from './charts'

const PRESETS = [
  { id: '7', label: '7 days' },
  { id: '14', label: '14 days' },
  { id: '30', label: '30 days' },
  { id: 'month', label: 'This month' },
  { id: 'custom', label: 'Custom' },
] as const

type PresetId = (typeof PRESETS)[number]['id']

function presetRange(preset: Exclude<PresetId, 'custom'>, today: DayKey): TrendRange {
  if (preset === 'month') return { first: `${today.slice(0, 7)}-01`, last: today }
  return { first: addDays(today, 1 - Number(preset)), last: today }
}

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
  const today = lagosDay(new Date(minute * 60_000))
  const [preset, setPreset] = useState<PresetId>('14')
  const [custom, setCustom] = useState<TrendRange>(() => presetRange('14', lagosDay(new Date())))
  const range = clampTrendRange(preset === 'custom' ? custom : presetRange(preset, today), today)
  const dashboard = useLiveQuery(
    async () => computeDashboard(await db.orders.toArray(), await db.payments.toArray(), new Date(minute * 60_000), range),
    [db, minute, range.first, range.last],
  )
  const hasOrders = useLiveQuery(async () => (await db.orders.filter((o) => !o.deleted_at).count()) > 0, [db])

  if (!dashboard) return null
  if (!hasOrders) {
    return (
      <p className="empty">No orders yet. Your dashboard fills in as you record orders and payments.</p>
    )
  }
  return (
    <DashboardView
      d={dashboard}
      preset={preset}
      range={range}
      today={today}
      onPreset={(next) => {
        if (next === 'custom') setCustom(range)
        setPreset(next)
      }}
      onCustom={(next) => setCustom(clampTrendRange(next, today))}
    />
  )
}

function DashboardView({
  d,
  preset,
  range,
  today,
  onPreset,
  onCustom,
}: {
  d: Dashboard
  preset: PresetId
  range: TrendRange
  today: DayKey
  onPreset: (preset: PresetId) => void
  onCustom: (range: TrendRange) => void
}) {
  const lastMonthRange = formatDayRange(d.lastMonthToDate.firstDay, d.lastMonthToDate.lastDay)
  const trendStart = d.trend[0].day
  const trendEnd = d.trend[d.trend.length - 1].day
  const trendLabel = formatDayRange(trendStart, trendEnd)
  const labelEvery = Math.max(1, Math.ceil(d.trend.length / 4))

  function setDay(which: 'first' | 'last', value: string) {
    if (!isDayKey(value)) return
    onCustom({ ...range, [which]: value })
  }

  function download() {
    downloadCsv(`report-${trendStart}-to-${trendEnd}.csv`, trendCsv(d.trend))
  }

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

      <section className="card report-range">
        <h3>Daily report</h3>
        <div className="report-range__presets" role="group" aria-label="Daily report period">
          {PRESETS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={preset === item.id ? 'segmented__option is-selected' : 'segmented__option'}
              aria-pressed={preset === item.id}
              onClick={() => onPreset(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        {preset === 'custom' && (
          <div className="report-range__dates">
            <label className="field">
              <span className="field__label">From</span>
              <input type="date" value={range.first} max={today} onChange={(e) => setDay('first', e.target.value)} />
            </label>
            <label className="field">
              <span className="field__label">To</span>
              <input type="date" value={range.last} max={today} onChange={(e) => setDay('last', e.target.value)} />
            </label>
          </div>
        )}
        <button type="button" className="button" onClick={download}>
          Download CSV
        </button>
      </section>

      <section className="card">
        <ColumnChart
          title={`Orders per day, ${trendLabel}`}
          data={d.trend.map((t) => ({
            key: t.day,
            label: formatWeekday(t.day),
            value: t.orders,
            display: `${t.orders} ${t.orders === 1 ? 'order' : 'orders'}`,
          }))}
          formatTick={(v) => String(v)}
          labelEvery={labelEvery}
          wholeNumbers
        />
      </section>

      <section className="card">
        <ColumnChart
          title={`Money received per day, ${trendLabel}`}
          data={d.trend.map((t) => ({
            key: t.day,
            label: formatWeekday(t.day),
            value: t.revenueKobo,
            display: formatKobo(t.revenueKobo),
          }))}
          formatTick={(v) => formatNairaCompact(v)}
          labelEvery={labelEvery}
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
