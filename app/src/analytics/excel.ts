import type { SheetData } from 'write-excel-file/browser'
import type { TrendPoint } from './dashboard'

/** Character widths. The date column fits `yyyy-mm-dd`, so Excel does not show `#######`. */
export const TREND_SHEET = {
  sheet: 'Daily report',
  columns: [{ width: 14 }, { width: 10 }, { width: 16 }, { width: 12 }, { width: 20 }],
  dateFormat: 'yyyy-mm-dd',
}

export function trendSheet(trend: readonly TrendPoint[]): SheetData {
  const header = ['date', 'orders', 'revenue_naira', 'delivered', 'pending payments'].map((value) => ({
    value,
    type: String,
    fontWeight: 'bold' as const,
  }))
  const rows = trend.map((point) => [
    { value: new Date(`${point.day}T00:00:00.000Z`), type: Date, format: 'yyyy-mm-dd' },
    { value: point.orders, type: Number },
    money(point.revenueKobo),
    { value: point.delivered, type: Number },
    money(point.pendingKobo),
  ])
  const revenueKobo = trend.reduce((sum, point) => sum + point.revenueKobo, 0)
  const pendingKobo = trend.reduce((sum, point) => sum + point.pendingKobo, 0)
  const total = [
    { value: 'Total', type: String, fontWeight: 'bold' as const },
    null,
    money(revenueKobo, true),
    null,
    money(pendingKobo, true),
  ]
  return [header, ...rows, total]
}

function money(kobo: number, bold = false) {
  return { value: nairaFromKobo(kobo), type: Number, format: '0.00', fontWeight: bold ? ('bold' as const) : undefined }
}

function nairaFromKobo(kobo: number): number {
  const sign = kobo < 0 ? -1 : 1
  const abs = Math.abs(kobo)
  return sign * (Math.floor(abs / 100) + (abs % 100) / 100)
}

/** Saves the daily report as an Excel workbook. Works offline; the numbers are already on the device. */
export async function downloadTrendReport(filename: string, trend: readonly TrendPoint[]): Promise<void> {
  const { default: writeXlsxFile } = await import('write-excel-file/browser')
  await writeXlsxFile(trendSheet(trend), TREND_SHEET).toFile(filename)
}
