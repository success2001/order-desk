import { describe, expect, it } from 'vitest'
import { trendCsv } from './csv'
import type { TrendPoint } from './dashboard'

describe('trendCsv', () => {
  it('writes a header and one row per day, with revenue in naira', () => {
    const trend: TrendPoint[] = [
      { day: '2026-10-08', orders: 1, revenueKobo: 0, delivered: 0 },
      { day: '2026-10-09', orders: 0, revenueKobo: 250_050, delivered: 1 },
    ]
    expect(trendCsv(trend)).toBe(
      'date,orders,revenue_naira,delivered\r\n2026-10-08,1,0.00,0\r\n2026-10-09,0,2500.50,1',
    )
  })

  it('is just the header when the range is empty', () => {
    expect(trendCsv([])).toBe('date,orders,revenue_naira,delivered')
  })
})
