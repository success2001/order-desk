import type { DayKey } from './time'

// Display formats for the dashboard. Day keys are Lagos calendar days, so they're
// formatted as plain dates (in UTC, which leaves the calendar date unchanged).

const dayMonth = new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const weekdayDay = new Intl.DateTimeFormat('en-NG', { weekday: 'short', day: 'numeric', timeZone: 'UTC' })
const compact = new Intl.NumberFormat('en-NG', { notation: 'compact', maximumFractionDigits: 1 })
const whole = new Intl.NumberFormat('en-NG', { maximumFractionDigits: 0 })

const asDate = (day: DayKey) => new Date(`${day}T12:00:00.000Z`)

/** "10 Oct" */
export function formatDay(day: DayKey): string {
  return dayMonth.format(asDate(day))
}

/** "Sat 10", for chart axes. */
export function formatWeekday(day: DayKey): string {
  return weekdayDay.format(asDate(day))
}

/** "1–10 Sep", or "10 Sep" for a single day. */
export function formatDayRange(first: DayKey, last: DayKey): string {
  if (first === last) return formatDay(first)
  const [, firstMonth, firstDay] = first.split('-')
  const [, lastMonth] = last.split('-')
  return firstMonth === lastMonth ? `${Number(firstDay)}–${formatDay(last)}` : `${formatDay(first)} – ${formatDay(last)}`
}

/**
 * Naira for stat tiles: whole naira up to ₦99,999, compact above
 * (₦250K, ₦1.3M), so large amounts fit on a phone.
 */
export function formatNairaCompact(kobo: number): string {
  const naira = Math.round(kobo / 100)
  const sign = naira < 0 ? '-' : ''
  const abs = Math.abs(naira)
  return `${sign}₦${abs < 100_000 ? whole.format(abs) : compact.format(abs)}`
}
