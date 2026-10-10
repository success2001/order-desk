import { describe, expect, it } from 'vitest'
import { formatDay, formatDayRange, formatNairaCompact, formatWeekday } from './format'

describe('day labels', () => {
  it('formats Lagos day keys as calendar dates, whatever the device time zone', () => {
    expect(formatDay('2026-10-10')).toBe('10 Oct')
    expect(formatWeekday('2026-10-10')).toMatch(/^Sat,? 10$/)
  })

  // (en-NG abbreviates September as "Sept", so these use October/November.)
  it('formats ranges compactly', () => {
    expect(formatDayRange('2026-10-01', '2026-10-10')).toBe('1–10 Oct')
    expect(formatDayRange('2026-10-28', '2026-11-02')).toBe('28 Oct – 2 Nov')
    expect(formatDayRange('2026-10-10', '2026-10-10')).toBe('10 Oct')
  })
})

describe('formatNairaCompact', () => {
  it.each([
    [0, '₦0'],
    [2_500_000, '₦25,000'],
    [9_999_900, '₦99,999'],
    [25_000_000, '₦250K'],
    [125_000_000, '₦1.3M'],
    [-50_000, '-₦500'],
  ])('formats %d kobo as %s', (kobo, expected) => {
    expect(formatNairaCompact(kobo)).toBe(expected)
  })
})
