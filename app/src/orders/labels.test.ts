import { describe, expect, it } from 'vitest'
import { formatOrderDate, nextFulfilmentStep } from './labels'

describe('nextFulfilmentStep', () => {
  it('moves pending → dispatched → delivered', () => {
    expect(nextFulfilmentStep('pending')?.status).toBe('dispatched')
    expect(nextFulfilmentStep('dispatched')?.status).toBe('delivered')
  })

  it('has no next step for finished orders', () => {
    expect(nextFulfilmentStep('delivered')).toBeNull()
    expect(nextFulfilmentStep('cancelled')).toBeNull()
  })
})

describe('formatOrderDate', () => {
  // Built from local-time parts so the test passes in any time zone.
  const now = new Date(2026, 9, 10, 15, 0)
  const at = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).toISOString()

  it('labels today and yesterday', () => {
    expect(formatOrderDate(at(2026, 9, 10, 9), now)).toMatch(/^Today, /)
    expect(formatOrderDate(at(2026, 9, 9, 23), now)).toMatch(/^Yesterday, /)
  })

  it('uses a 12-hour clock (12:44 am, not 0:44)', () => {
    expect(formatOrderDate(new Date(2026, 9, 10, 0, 44).toISOString(), now)).toMatch(/^Today, 12:44\s?am$/i)
  })

  it('shows day and month earlier this year, and the year for older orders', () => {
    expect(formatOrderDate(at(2026, 9, 1), now)).not.toMatch(/2026|Today|Yesterday/)
    expect(formatOrderDate(at(2025, 11, 31), now)).toMatch(/2025/)
  })
})
