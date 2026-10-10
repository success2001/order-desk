import type { Channel, FulfilmentStatus, PaymentStatus } from './types'

export const CHANNEL_LABELS: Record<Channel, string> = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  x: 'X',
  other: 'Other',
}

export const PAYMENT_LABELS: Record<PaymentStatus, string> = {
  unpaid: 'Unpaid',
  'part-paid': 'Part-paid',
  paid: 'Paid',
}

export const FULFILMENT_LABELS: Record<FulfilmentStatus, string> = {
  pending: 'Not sent',
  dispatched: 'Dispatched',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
}

/** The one-tap next step for an order, or null when it is finished. */
export function nextFulfilmentStep(status: FulfilmentStatus): { label: string; status: FulfilmentStatus } | null {
  switch (status) {
    case 'pending':
      return { label: 'Mark dispatched', status: 'dispatched' }
    case 'dispatched':
      return { label: 'Mark delivered', status: 'delivered' }
    case 'delivered':
    case 'cancelled':
      return null
  }
}

// 12-hour clock: en-NG otherwise gives "0:44" for 12:44 am.
const time = new Intl.DateTimeFormat('en-NG', { hour: 'numeric', minute: '2-digit', hour12: true })
const dayMonth = new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'short' })
const dayMonthYear = new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })

/** "Today, 2:05 pm", "Yesterday, 9:10 am", "12 Oct" or "12 Oct 2025" (in the phone's time zone). */
export function formatOrderDate(iso: string, now = new Date()): string {
  const date = new Date(iso)
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfYesterday = new Date(startOfToday.getTime())
  startOfYesterday.setDate(startOfYesterday.getDate() - 1)

  if (date >= startOfToday) return `Today, ${time.format(date)}`
  if (date >= startOfYesterday) return `Yesterday, ${time.format(date)}`
  if (date.getFullYear() === now.getFullYear()) return dayMonth.format(date)
  return dayMonthYear.format(date)
}
