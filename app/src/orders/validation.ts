import { CHANNELS, FULFILMENT_STATUSES, type Order } from './types'

// Mirrors the check constraints on public.orders, so invalid data is caught
// on the device instead of failing later during sync.

export type OrderFields = Pick<
  Order,
  | 'customer_name'
  | 'customer_phone'
  | 'channel'
  | 'items'
  | 'amount_due_kobo'
  | 'fulfilment_status'
  | 'notes'
>

export type ValidationErrors = Partial<Record<keyof OrderFields, string>>

export function validateOrder(o: OrderFields): ValidationErrors {
  const errors: ValidationErrors = {}

  const name = o.customer_name.trim()
  if (name.length === 0) errors.customer_name = 'Enter the customer’s name.'
  else if (name.length > 200) errors.customer_name = 'Name is too long (max 200 characters).'

  if (o.customer_phone && o.customer_phone.length > 30) errors.customer_phone = 'Phone number is too long.'

  if (!CHANNELS.includes(o.channel)) errors.channel = 'Choose where the order came from.'

  const items = o.items.trim()
  if (items.length === 0) errors.items = 'Enter what was ordered.'
  else if (items.length > 2000) errors.items = 'Items are too long (max 2000 characters).'

  if (!isAmount(o.amount_due_kobo)) errors.amount_due_kobo = 'Enter a valid amount.'

  if (!FULFILMENT_STATUSES.includes(o.fulfilment_status)) errors.fulfilment_status = 'Unknown delivery status.'

  if (o.notes && o.notes.length > 2000) errors.notes = 'Notes are too long (max 2000 characters).'

  return errors
}

function isAmount(kobo: number): boolean {
  return Number.isSafeInteger(kobo) && kobo >= 0
}
