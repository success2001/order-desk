import { unzipSync, strFromU8 } from 'fflate'
import { describe, expect, it } from 'vitest'
import writeXlsxFile from 'write-excel-file/node'
import type { TrendPoint } from './dashboard'
import { TREND_SHEET, trendSheet } from './excel'

const DAY_MS = 86_400_000
const EXCEL_EPOCH_DAYS = 70 * 365 + 19

function excelSerial(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`) / DAY_MS + EXCEL_EPOCH_DAYS
}

async function workbookXml(trend: readonly TrendPoint[]): Promise<Record<string, string>> {
  const buffer = await writeXlsxFile(trendSheet(trend), TREND_SHEET).toBuffer()
  const files = unzipSync(new Uint8Array(buffer))
  return Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, strFromU8(bytes)]))
}

describe('trendSheet', () => {
  it('writes dates as yyyy-mm-dd in a column wide enough to show them, and revenue in naira', async () => {
    const trend: TrendPoint[] = [
      { day: '2026-10-08', orders: 1, revenueKobo: 0, delivered: 0 },
      { day: '2026-10-09', orders: 0, revenueKobo: 250_050, delivered: 1 },
    ]
    const xml = await workbookXml(trend)
    const sheet = xml['xl/worksheets/sheet1.xml']
    const strings = xml['xl/sharedStrings.xml']
    const styles = xml['xl/styles.xml']

    expect(strings).toContain('date')
    expect(strings).toContain('revenue_naira')
    expect(sheet).toContain('min="1" max="1" width="14"')
    expect(sheet).toContain('min="3" max="3" width="16"')
    expect(sheet).toContain(`<v>${excelSerial('2026-10-08')}</v>`)
    expect(sheet).toContain(`<v>${excelSerial('2026-10-09')}</v>`)
    expect(sheet).toContain('<v>2500.5</v>')
    expect(styles).toContain('yyyy-mm-dd')
    expect(styles).toContain('0.00')
  })

  it('is just the header when the range is empty', async () => {
    const xml = await workbookXml([])
    expect(xml['xl/sharedStrings.xml']).toContain('delivered')
    expect(xml['xl/worksheets/sheet1.xml'].match(/<row /g)).toHaveLength(1)
  })
})
