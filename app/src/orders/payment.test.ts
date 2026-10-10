import { describe, expect, it } from 'vitest'
import { balanceKobo, paymentStatus } from './payment'

const amounts = (due: number, paid: number) => ({ amount_due_kobo: due, amount_paid_kobo: paid })

describe('paymentStatus', () => {
  it('is unpaid when nothing has been received', () => {
    expect(paymentStatus(amounts(2_500_000, 0))).toBe('unpaid')
  })

  it('is part-paid when some but not all has been received', () => {
    expect(paymentStatus(amounts(2_500_000, 1))).toBe('part-paid')
    expect(paymentStatus(amounts(2_500_000, 2_499_999))).toBe('part-paid')
  })

  it('is paid when the full amount has been received', () => {
    expect(paymentStatus(amounts(2_500_000, 2_500_000))).toBe('paid')
  })

  it('is paid when the customer overpaid', () => {
    expect(paymentStatus(amounts(2_500_000, 3_000_000))).toBe('paid')
  })

  it('treats a ₦0 order (e.g. a free replacement) as paid', () => {
    expect(paymentStatus(amounts(0, 0))).toBe('paid')
  })
})

describe('balanceKobo', () => {
  it('returns what is still owed', () => {
    expect(balanceKobo(amounts(2_500_000, 1_000_000))).toBe(1_500_000)
  })

  it('is zero when fully paid and negative when overpaid', () => {
    expect(balanceKobo(amounts(2_500_000, 2_500_000))).toBe(0)
    expect(balanceKobo(amounts(2_500_000, 3_000_000))).toBe(-500_000)
  })
})
