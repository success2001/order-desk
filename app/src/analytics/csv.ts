import type { TrendPoint } from './dashboard'

/** Daily report as CSV. Revenue is naira with two decimals so a spreadsheet can sum it. */
export function trendCsv(trend: readonly TrendPoint[]): string {
  const lines = ['date,orders,revenue_naira,delivered']
  for (const point of trend) {
    lines.push(`${point.day},${point.orders},${nairaFromKobo(point.revenueKobo)},${point.delivered}`)
  }
  return lines.join('\r\n')
}

function nairaFromKobo(kobo: number): string {
  const sign = kobo < 0 ? '-' : ''
  const abs = Math.abs(kobo)
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

/** Saves `csv` as a file download. Works offline; the numbers are already on the device. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
