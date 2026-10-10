/** A round axis maximum: 1, 2 or 5 × 10ⁿ at or above `value` (1 for nothing to show). */
export function niceMax(value: number): number {
  if (value <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  return [1, 2, 5, 10].map((step) => step * magnitude).find((n) => n >= value)!
}

/**
 * Gridline values: 0, the middle and the maximum. For whole-number data (e.g.
 * order counts) the middle is left out when it isn't a whole number, so an axis
 * never shows a tick like "0.5 orders" rounded to a misleading "1".
 */
export function axisTicks(max: number, wholeNumbers: boolean): number[] {
  const middle = max / 2
  return wholeNumbers && !Number.isInteger(middle) ? [0, max] : [0, middle, max]
}

/**
 * Which category labels to show on the x-axis: every `every`-th one counted back
 * from the last, so the latest (e.g. today) is always labelled and labels never
 * crowd together at the end.
 */
export function labelledIndexes(count: number, every: number): Set<number> {
  const shown = new Set<number>()
  for (let i = count - 1; i >= 0; i -= Math.max(1, every)) shown.add(i)
  return shown
}
