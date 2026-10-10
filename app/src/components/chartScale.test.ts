import { describe, expect, it } from 'vitest'
import { axisTicks, labelledIndexes, niceMax } from './chartScale'

describe('niceMax', () => {
  it.each([
    [0, 1],
    [1, 1],
    [3, 5],
    [7, 10],
    [12, 20],
    [48, 50],
    [51, 100],
    [2_500_000, 5_000_000],
  ])('rounds %d up to %d', (value, expected) => {
    expect(niceMax(value)).toBe(expected)
  })
})

describe('axisTicks', () => {
  it('shows 0, middle and maximum', () => {
    expect(axisTicks(5_000_000, false)).toEqual([0, 2_500_000, 5_000_000])
    expect(axisTicks(10, true)).toEqual([0, 5, 10])
  })

  it('never shows a fractional middle tick for whole-number data', () => {
    expect(axisTicks(1, true)).toEqual([0, 1])
    expect(axisTicks(5, true)).toEqual([0, 5])
  })
})

describe('labelledIndexes', () => {
  it('labels every nth category counting back from the last, so the last is always labelled', () => {
    expect([...labelledIndexes(14, 4)].sort((a, b) => a - b)).toEqual([1, 5, 9, 13])
    expect([...labelledIndexes(3, 1)].sort((a, b) => a - b)).toEqual([0, 1, 2])
  })

  it('never puts two labels next to each other at the end', () => {
    const shown = [...labelledIndexes(14, 4)].sort((a, b) => a - b)
    expect(shown.at(-1)! - shown.at(-2)!).toBe(4)
  })
})
