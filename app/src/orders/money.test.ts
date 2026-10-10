import { describe, expect, it } from 'vitest'
import { formatKobo, koboToInput, parseNairaToKobo } from './money'

describe('koboToInput', () => {
  it.each([
    [0, '0'],
    [2_500_000, '25000'],
    [2_500_050, '25000.50'],
    [5, '0.05'],
  ])('turns %d kobo into %j, which parses back to the same amount', (kobo, expected) => {
    expect(koboToInput(kobo)).toBe(expected)
    expect(parseNairaToKobo(koboToInput(kobo))).toBe(kobo)
  })
})

describe('parseNairaToKobo', () => {
  it.each([
    ['25000', 2_500_000],
    ['25,000', 2_500_000],
    ['₦25,000', 2_500_000],
    ['N25,000', 2_500_000],
    ['NGN 1,500', 150_000],
    ['  1 500 ', 150_000],
    ['25000.5', 2_500_050],
    ['25000.50', 2_500_050],
    ['0.01', 1],
    ['0', 0],
  ])('parses %j as %d kobo', (input, expected) => {
    expect(parseNairaToKobo(input)).toBe(expected)
  })

  it('avoids floating-point rounding (0.29 naira is exactly 29 kobo)', () => {
    expect(parseNairaToKobo('0.29')).toBe(29)
    expect(parseNairaToKobo('1.15')).toBe(115)
  })

  it.each(['', ' ', 'abc', '-500', '12.345', '1.2.3', '₦', '1e5', '١٢٣'])('rejects %j', (input) => {
    expect(parseNairaToKobo(input)).toBeNull()
  })

  it('rejects amounts too large to store exactly', () => {
    expect(parseNairaToKobo('999999999999999999')).toBeNull()
  })
})

describe('formatKobo', () => {
  it.each([
    [0, '₦0'],
    [100, '₦1'],
    [2_500_000, '₦25,000'],
    [2_500_050, '₦25,000.50'],
    [2_500_005, '₦25,000.05'],
    [123_456_789_00, '₦123,456,789'],
    [-50_000, '-₦500'],
  ])('formats %d kobo as %s', (kobo, expected) => {
    expect(formatKobo(kobo)).toBe(expected)
  })
})
