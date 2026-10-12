import { describe, expect, it } from 'vitest'
import {
  addDays,
  dayOfMonth,
  daysInMonth,
  inDays,
  inclusiveDayCount,
  isDayKey,
  lagosDay,
  lagosMonth,
  previousMonth,
  startOfLagosDay,
} from './time'

describe('Lagos calendar days and months', () => {
  it('uses Lagos time (UTC+1), not UTC or the device time zone', () => {
    expect(lagosDay('2026-10-09T23:30:00.000Z')).toBe('2026-10-10') // 00:30 in Lagos
    expect(lagosDay('2026-10-09T22:59:59.999Z')).toBe('2026-10-09') // 23:59 in Lagos
    expect(lagosMonth('2026-09-30T23:30:00.000Z')).toBe('2026-10')
    expect(lagosMonth('2026-12-31T23:00:00.000Z')).toBe('2027-01')
  })

  it('knows when a Lagos day starts', () => {
    expect(startOfLagosDay('2026-10-10')).toBe(Date.parse('2026-10-09T23:00:00.000Z'))
  })

  it('moves across months and years', () => {
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(previousMonth('2026-01')).toBe('2025-12')
    expect(previousMonth('2026-10')).toBe('2026-09')
  })

  it('accepts real calendar days and counts them inclusively', () => {
    expect(isDayKey('2026-10-10')).toBe(true)
    expect(isDayKey('2026-02-31')).toBe(false)
    expect(isDayKey('10 Oct')).toBe(false)
    expect(inclusiveDayCount('2026-10-10', '2026-10-10')).toBe(1)
    expect(inclusiveDayCount('2026-09-27', '2026-10-10')).toBe(14)
  })

  it('clamps a day number to the month length', () => {
    expect(daysInMonth('2026-02')).toBe(28)
    expect(daysInMonth('2028-02')).toBe(29)
    expect(dayOfMonth('2026-02', 31)).toBe('2026-02-28')
    expect(dayOfMonth('2026-09', 10)).toBe('2026-09-10')
  })

  it('checks whether an instant falls in a range of days (inclusive)', () => {
    expect(inDays('2026-10-09T23:30:00.000Z', '2026-10-10', '2026-10-10')).toBe(true)
    expect(inDays('2026-10-09T22:30:00.000Z', '2026-10-10', '2026-10-10')).toBe(false)
    expect(inDays(null, '2026-10-01', '2026-10-31')).toBe(false)
  })
})
