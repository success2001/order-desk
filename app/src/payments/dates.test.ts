import { describe, expect, it } from 'vitest'
import { MAX_BACKDATE_DAYS } from './validation'
import { PICKER_MAX_DAYS_BACK, dateInputRange, paidAtFromDateInput, toDateInputValue } from './dates'

// Built from local-time parts so the tests pass in any time zone.
const now = new Date(2026, 9, 10, 15, 30) // 10 Oct 2026, 3:30 pm local

describe('toDateInputValue', () => {
  it('formats the local calendar date as YYYY-MM-DD', () => {
    expect(toDateInputValue(now)).toBe('2026-10-10')
    expect(toDateInputValue(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
  })
})

describe('dateInputRange', () => {
  it('runs from 89 days ago to today', () => {
    expect(dateInputRange(now)).toEqual({ min: '2026-07-13', max: '2026-10-10' })
  })
})

describe('paidAtFromDateInput', () => {
  it('uses the current time for today', () => {
    expect(paidAtFromDateInput('2026-10-10', now)).toBe(now.toISOString())
  })

  it('uses noon local time for an earlier day', () => {
    expect(paidAtFromDateInput('2026-10-07', now)).toBe(new Date(2026, 9, 7, 12).toISOString())
  })

  it.each(['', '7 Oct', '2026-10-7', '2026-02-31', '2026-13-01'])('rejects %j', (value) => {
    expect(paidAtFromDateInput(value, now)).toBeNull()
  })

  it('keeps the earliest pickable date inside the server’s 90-day limit', () => {
    const earliest = Date.parse(paidAtFromDateInput(dateInputRange(now).min, now)!)
    expect(PICKER_MAX_DAYS_BACK).toBeLessThan(MAX_BACKDATE_DAYS)
    expect(earliest).toBeGreaterThanOrEqual(now.getTime() - MAX_BACKDATE_DAYS * 86_400_000)
  })
})
