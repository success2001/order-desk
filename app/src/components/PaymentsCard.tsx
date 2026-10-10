import { useLiveQuery } from 'dexie-react-hooks'
import { useState, type FormEvent } from 'react'
import { formatOrderDate } from '../orders/labels'
import { formatKobo, parseNairaToKobo } from '../orders/money'
import { balanceKobo, paymentStatus } from '../orders/payment'
import { OrderNotFoundError } from '../orders/repository'
import type { Order } from '../orders/types'
import { useDb } from '../orders/useDb'
import { dateInputRange, paidAtFromDateInput, toDateInputValue } from '../payments/dates'
import { PAYMENT_METHOD_LABELS } from '../payments/labels'
import {
  PaymentNotFoundError,
  PaymentValidationError,
  markFullyPaid,
  paymentsForOrder,
  recordPayment,
  voidPayment,
} from '../payments/repository'
import { PAYMENT_METHODS, type PaymentMethod } from '../payments/types'
import { PaymentBadge } from './Badges'

interface Draft {
  amount: string
  date: string
  method: PaymentMethod | ''
}

const newDraft = (): Draft => ({ amount: '', date: toDateInputValue(new Date()), method: '' })

/** An order's payments: totals, history, recording and voiding. */
export function PaymentsCard({ order }: { order: Order }) {
  const db = useDb()
  // The order's payments that aren't voided, most recent first. "Paid" is their sum.
  const payments = useLiveQuery(() => paymentsForOrder(db, order.id), [db, order.id], [])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)

  const paid = payments.reduce((total, p) => total + p.amount_kobo, 0)
  const balance = balanceKobo(order.amount_due_kobo, paid)
  const range = dateInputRange()

  /** Runs an action and shows a readable message if it fails. Returns true on success. */
  async function run(action: () => Promise<unknown>): Promise<boolean> {
    setError(null)
    try {
      await action()
      return true
    } catch (err) {
      if (err instanceof PaymentValidationError) setError(Object.values(err.errors)[0] ?? 'Check the payment details.')
      else if (err instanceof OrderNotFoundError) setError('This order no longer exists.')
      else if (err instanceof PaymentNotFoundError) setError('That payment was already voided.')
      else setError('Something went wrong. Please try again.')
      return false
    }
  }

  async function handleRecord(event: FormEvent) {
    event.preventDefault()
    if (!draft) return
    const kobo = parseNairaToKobo(draft.amount)
    if (!kobo) {
      setError('Enter the amount received, e.g. 10,000')
      return
    }
    const paidAt = paidAtFromDateInput(draft.date)
    if (!paidAt) {
      setError('Choose the date the payment was received.')
      return
    }
    const saved = await run(() => recordPayment(db, order.id, kobo, { paid_at: paidAt, method: draft.method || null }))
    if (saved) setDraft(null)
  }

  function handleVoid(id: string, amountKobo: number) {
    if (confirm(`Void this ${formatKobo(amountKobo)} payment? It will no longer count as received.`)) {
      void run(() => voidPayment(db, id))
    }
  }

  return (
    <section className="card">
      <div className="card__title">
        <h3>Payment</h3>
        <PaymentBadge order={order} paid={paid} />
      </div>
      <dl className="amounts">
        <dt>Amount</dt>
        <dd>{formatKobo(order.amount_due_kobo)}</dd>
        <dt>Received</dt>
        <dd>{formatKobo(paid)}</dd>
        <dt>{balance < 0 ? 'Overpaid' : 'Still owed'}</dt>
        <dd className={balance > 0 ? 'owed' : undefined}>{formatKobo(Math.abs(balance))}</dd>
      </dl>

      {draft === null ? (
        <div className="actions">
          {paymentStatus(order.amount_due_kobo, paid) !== 'paid' && (
            <button type="button" className="button button--primary" onClick={() => run(() => markFullyPaid(db, order.id))}>
              Mark fully paid
            </button>
          )}
          <button
            type="button"
            className="button"
            onClick={() => {
              setError(null)
              setDraft(newDraft())
            }}
          >
            Record payment
          </button>
        </div>
      ) : (
        <form className="payment-form" onSubmit={handleRecord} noValidate>
          <label className="field">
            <span className="field__label">Amount received (₦)</span>
            <input
              value={draft.amount}
              onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
              inputMode="decimal"
              placeholder="10,000"
              aria-label="Amount received in naira"
              autoComplete="off"
              autoFocus
            />
          </label>
          <div className="payment-form__row">
            <label className="field">
              <span className="field__label">Date received</span>
              <input
                type="date"
                value={draft.date}
                min={range.min}
                max={range.max}
                onChange={(e) => setDraft({ ...draft, date: e.target.value })}
              />
            </label>
            <label className="field">
              <span className="field__label">Method (optional)</span>
              <select
                value={draft.method}
                onChange={(e) => setDraft({ ...draft, method: e.target.value as PaymentMethod | '' })}
              >
                <option value="">Not specified</option>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_METHOD_LABELS[m]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="actions">
            <button type="submit" className="button button--primary">
              Save payment
            </button>
            <button type="button" className="button button--ghost" onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {payments.length > 0 && (
        <>
          <h3 className="payments__heading">Payments received</h3>
          <ul className="payments" aria-label="Payments received">
            {payments.map((p) => (
              <li key={p.id} className="payment">
                <div className="payment__main">
                  <span className="payment__amount">{formatKobo(p.amount_kobo)}</span>
                  <span className="muted">
                    {formatOrderDate(p.paid_at)}
                    {p.method && ` · ${PAYMENT_METHOD_LABELS[p.method]}`}
                  </span>
                  {p.synced === 2 && <span className="badge badge--rejected">Not backed up</span>}
                </div>
                <button
                  type="button"
                  className="button button--small button--ghost button--danger"
                  aria-label={`Void ${formatKobo(p.amount_kobo)} payment`}
                  onClick={() => handleVoid(p.id, p.amount_kobo)}
                >
                  Void
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
