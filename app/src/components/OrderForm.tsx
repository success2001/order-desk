import { useState, type FormEvent, type ReactNode } from 'react'
import { goBack } from '../app/router'
import { CHANNEL_LABELS } from '../orders/labels'
import { koboToInput, parseNairaToKobo } from '../orders/money'
import { OrderValidationError, createOrder, updateOrder } from '../orders/repository'
import { useDb } from '../orders/useDb'
import { CHANNELS, type Channel, type Order } from '../orders/types'
import type { ValidationErrors } from '../orders/validation'

const LAST_CHANNEL_KEY = 'lastChannel'

function lastChannel(): Channel {
  try {
    const saved = localStorage.getItem(LAST_CHANNEL_KEY)
    return CHANNELS.includes(saved as Channel) ? (saved as Channel) : 'whatsapp'
  } catch {
    return 'whatsapp'
  }
}

function rememberChannel(channel: Channel) {
  try {
    localStorage.setItem(LAST_CHANNEL_KEY, channel)
  } catch {
    // Only a convenience; ignore if storage is unavailable.
  }
}

/** New order when `order` is absent, otherwise edits it. */
export function OrderForm({ order }: { order?: Order }) {
  const db = useDb()
  const [customerName, setCustomerName] = useState(order?.customer_name ?? '')
  const [items, setItems] = useState(order?.items ?? '')
  const [amountDue, setAmountDue] = useState(order ? koboToInput(order.amount_due_kobo) : '')
  const [channel, setChannel] = useState<Channel>(order?.channel ?? lastChannel)
  const [customerPhone, setCustomerPhone] = useState(order?.customer_phone ?? '')
  const [amountPaid, setAmountPaid] = useState(order && order.amount_paid_kobo > 0 ? koboToInput(order.amount_paid_kobo) : '')
  const [notes, setNotes] = useState(order?.notes ?? '')
  const [errors, setErrors] = useState<ValidationErrors>({})
  const [saving, setSaving] = useState(false)

  const hasMoreDetails = Boolean(order?.customer_phone || order?.notes || order?.amount_paid_kobo)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()

    const due = parseNairaToKobo(amountDue)
    const paid = amountPaid.trim() === '' ? 0 : parseNairaToKobo(amountPaid)
    const amountErrors: ValidationErrors = {}
    if (due === null) amountErrors.amount_due_kobo = 'Enter the amount, e.g. 25,000'
    if (paid === null) amountErrors.amount_paid_kobo = 'Enter the amount paid, e.g. 10,000'
    if (due === null || paid === null) {
      setErrors(amountErrors)
      return
    }

    const fields = {
      customer_name: customerName,
      items,
      amount_due_kobo: due,
      amount_paid_kobo: paid,
      channel,
      customer_phone: customerPhone,
      notes,
    }

    setSaving(true)
    try {
      if (order) await updateOrder(db, order.id, fields)
      else await createOrder(db, fields)
      rememberChannel(channel)
      goBack()
    } catch (err) {
      if (err instanceof OrderValidationError) setErrors(err.errors)
      else setErrors({ customer_name: 'Could not save. Please try again.' })
      setSaving(false)
    }
  }

  return (
    <form className="form" onSubmit={handleSubmit} noValidate>
      <Field label="Customer name" error={errors.customer_name}>
        <input
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
          autoFocus={!order}
          autoComplete="off"
          enterKeyHint="next"
          maxLength={200}
        />
      </Field>

      <Field label="What did they order?" error={errors.items}>
        <textarea
          value={items}
          onChange={(e) => setItems(e.target.value)}
          rows={2}
          placeholder="e.g. 2× Ankara gown (L)"
          maxLength={2000}
        />
      </Field>

      <Field label="Amount (₦)" error={errors.amount_due_kobo}>
        <input
          value={amountDue}
          onChange={(e) => setAmountDue(e.target.value)}
          inputMode="decimal"
          placeholder="25,000"
          autoComplete="off"
        />
      </Field>

      <fieldset className="field">
        <legend className="field__label">Order came from</legend>
        <div className="segmented">
          {CHANNELS.map((c) => (
            <button
              key={c}
              type="button"
              className={c === channel ? 'segmented__option is-selected' : 'segmented__option'}
              aria-pressed={c === channel}
              onClick={() => setChannel(c)}
            >
              {CHANNEL_LABELS[c]}
            </button>
          ))}
        </div>
      </fieldset>

      <details className="more" open={hasMoreDetails || Boolean(errors.customer_phone || errors.amount_paid_kobo || errors.notes)}>
        <summary>More details (optional)</summary>

        <Field label="Amount already paid (₦)" error={errors.amount_paid_kobo}>
          <input
            value={amountPaid}
            onChange={(e) => setAmountPaid(e.target.value)}
            inputMode="decimal"
            placeholder="0"
            autoComplete="off"
          />
        </Field>

        <Field label="Customer phone" error={errors.customer_phone}>
          <input
            value={customerPhone}
            onChange={(e) => setCustomerPhone(e.target.value)}
            type="tel"
            inputMode="tel"
            autoComplete="off"
            maxLength={30}
          />
        </Field>

        <Field label="Notes (address, landmark, delivery time…)" error={errors.notes}>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={2000} />
        </Field>
      </details>

      <div className="form__actions">
        <button type="submit" className="button button--primary" disabled={saving}>
          {order ? 'Save changes' : 'Save order'}
        </button>
      </div>
    </form>
  )
}

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className={error ? 'field has-error' : 'field'}>
      <span className="field__label">{label}</span>
      {children}
      {error && <span className="field__error">{error}</span>}
    </label>
  )
}
