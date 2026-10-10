// Money is stored as integer kobo (₦1 = 100 kobo) and never as floating-point naira.

/**
 * Parses what a vendor types into an amount field ("25000", "25,000", "₦25,000.50", "N 1,500")
 * into kobo. Returns null for anything that isn't a valid non-negative amount with at most 2 decimals.
 */
export function parseNairaToKobo(input: string): number | null {
  const cleaned = input.trim().replace(/^(₦|NGN|N)\s*/i, '').replace(/[,\s]/g, '')
  const match = cleaned.match(/^(\d+)(?:\.(\d{1,2}))?$/)
  if (!match) return null

  const [, naira, kobo = ''] = match
  const total = Number(naira) * 100 + Number(kobo.padEnd(2, '0'))
  return Number.isSafeInteger(total) ? total : null
}

/** Kobo as an editable amount field value: 2500000 → "25000", 2500050 → "25000.50". */
export function koboToInput(kobo: number): string {
  const naira = Math.floor(kobo / 100)
  const rest = kobo % 100
  return rest === 0 ? String(naira) : `${naira}.${String(rest).padStart(2, '0')}`
}

const wholeNaira =new Intl.NumberFormat('en-NG', { maximumFractionDigits: 0 })

/** Formats kobo for display: 2500000 → "₦25,000", 2500050 → "₦25,000.50", -50000 → "-₦500". */
export function formatKobo(kobo: number): string {
  const sign = kobo < 0 ? '-' : ''
  const abs = Math.abs(kobo)
  const naira = Math.floor(abs / 100)
  const rest = abs % 100
  const fraction = rest === 0 ? '' : `.${String(rest).padStart(2, '0')}`
  return `${sign}₦${wholeNaira.format(naira)}${fraction}`
}
