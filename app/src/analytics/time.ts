// Reporting periods are Lagos calendar days and months (BUILD_PLAN.md D19), so
// every device reports the same figures even if its own time zone is wrong.
//
// Africa/Lagos is West Africa Time: UTC+1 all year, no daylight saving. A fixed
// offset is exact and doesn't depend on the browser's time zone data.

const LAGOS_OFFSET_MS = 60 * 60_000
const DAY_MS = 86_400_000

/** A Lagos calendar day, "YYYY-MM-DD". */
export type DayKey = string
/** A Lagos calendar month, "YYYY-MM". */
export type MonthKey = string

/** The Lagos calendar day of an instant. */
export function lagosDay(instant: Date | string | number): DayKey {
  return new Date(new Date(instant).getTime() + LAGOS_OFFSET_MS).toISOString().slice(0, 10)
}

/** The Lagos calendar month of an instant. */
export function lagosMonth(instant: Date | string | number): MonthKey {
  return lagosDay(instant).slice(0, 7)
}

/** UTC instant (ms) when a Lagos day starts. */
export function startOfLagosDay(day: DayKey): number {
  return Date.parse(`${day}T00:00:00.000Z`) - LAGOS_OFFSET_MS
}

/** The Lagos day `n` days after (or before, if negative) `day`. */
export function addDays(day: DayKey, n: number): DayKey {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + n * DAY_MS).toISOString().slice(0, 10)
}

/** The month before `month`. */
export function previousMonth(month: MonthKey): MonthKey {
  const [y, m] = month.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

/** Number of days in a month. */
export function daysInMonth(month: MonthKey): number {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** A day of a month, clamped to the month's length (e.g. day 31 of February → the 28th or 29th). */
export function dayOfMonth(month: MonthKey, dayNumber: number): DayKey {
  return `${month}-${String(Math.min(dayNumber, daysInMonth(month))).padStart(2, '0')}`
}

/** True if `instant` falls on a Lagos day from `first` to `last` inclusive. */
export function inDays(instant: string | null | undefined, first: DayKey, last: DayKey): boolean {
  if (!instant) return false
  const day = lagosDay(instant)
  return day >= first && day <= last
}
