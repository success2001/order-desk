// "Date received" for the payment form's date picker (<input type="date">,
// which works in local YYYY-MM-DD values).

/**
 * How far back the picker goes. The server allows 90 days before the payment is
 * recorded; one day less keeps a backdated "noon" safely inside that limit.
 */
export const PICKER_MAX_DAYS_BACK = 89

/** A date as the picker's value (local calendar date, YYYY-MM-DD). */
export function toDateInputValue(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** The picker's allowed range: from PICKER_MAX_DAYS_BACK days ago to today. */
export function dateInputRange(now = new Date()): { min: string; max: string } {
  const earliest = new Date(now.getFullYear(), now.getMonth(), now.getDate() - PICKER_MAX_DAYS_BACK)
  return { min: toDateInputValue(earliest), max: toDateInputValue(now) }
}

/**
 * The payment's paid_at for a picked date:
 * - today → now (the exact time it was recorded)
 * - an earlier day → noon on that day, so time zones can't shift it to another day
 * Returns null for anything that isn't a valid YYYY-MM-DD date.
 */
export function paidAtFromDateInput(value: string, now = new Date()): string | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const [y, m, d] = match.slice(1).map(Number)
  const noon = new Date(y, m - 1, d, 12)
  // Reject impossible dates such as 2026-02-31 (which Date would roll over).
  if (noon.getFullYear() !== y || noon.getMonth() !== m - 1 || noon.getDate() !== d) return null
  return value === toDateInputValue(now) ? now.toISOString() : noon.toISOString()
}
