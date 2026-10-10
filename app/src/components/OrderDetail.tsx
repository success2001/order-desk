import { useState } from 'react'
import { goBack, navigate } from '../app/router'
import { CHANNEL_LABELS, formatOrderDate, nextFulfilmentStep } from '../orders/labels'
import { OrderNotFoundError, OrderValidationError, deleteOrder, setFulfilmentStatus } from '../orders/repository'
import { useDb } from '../orders/useDb'
import type { Order } from '../orders/types'
import { FulfilmentBadge } from './Badges'
import { PaymentsCard } from './PaymentsCard'

export function OrderDetail({ order }: { order: Order }) {
  const db = useDb()
  const [error, setError] = useState<string | null>(null)

  /** Runs an action and shows a readable message if it fails. Returns true on success. */
  async function run(action: () => Promise<unknown>): Promise<boolean> {
    setError(null)
    try {
      await action()
      return true
    } catch (err) {
      if (err instanceof OrderValidationError) setError(Object.values(err.errors)[0] ?? 'Check the details and try again.')
      else if (err instanceof OrderNotFoundError) setError('This order no longer exists.')
      else setError('Something went wrong. Please try again.')
      return false
    }
  }

  const next = nextFulfilmentStep(order.fulfilment_status)
  const isOpen = order.fulfilment_status === 'pending' || order.fulfilment_status === 'dispatched'

  return (
    <div className="detail">
      <header className="detail__header">
        <h2>{order.customer_name}</h2>
        <p className="muted">
          {CHANNEL_LABELS[order.channel]} · {formatOrderDate(order.created_at)}
          {order.customer_phone && (
            <>
              {' · '}
              <a href={`tel:${order.customer_phone}`}>{order.customer_phone}</a>
            </>
          )}
        </p>
      </header>

      {order.synced === 2 && (
        <div className="card card--attention" role="alert">
          <h3>Not backed up</h3>
          <p>The server didn’t accept the last change to this order, so it’s only saved on this phone. Edit the order to try again.</p>
          {order.sync_error && <p className="muted small">Reason: {order.sync_error}</p>}
        </div>
      )}

      <section className="card">
        <h3>Items</h3>
        <p className="prewrap">{order.items}</p>
        {order.delivery_address && (
          <>
            <h3>Delivery address</h3>
            <p className="prewrap">{order.delivery_address}</p>
          </>
        )}
        {order.notes && (
          <>
            <h3>Notes</h3>
            <p className="prewrap">{order.notes}</p>
          </>
        )}
      </section>

      <PaymentsCard order={order} />

      <section className="card">
        <div className="card__title">
          <h3>Delivery</h3>
          <FulfilmentBadge order={order} />
        </div>
        {order.delivered_at && <p className="muted">Delivered {formatOrderDate(order.delivered_at)}</p>}
        <div className="actions">
          {next && (
            <button
              type="button"
              className="button button--primary"
              onClick={() => run(() => setFulfilmentStatus(db, order.id, next.status))}
            >
              {next.label}
            </button>
          )}
          {isOpen ? (
            <button
              type="button"
              className="button"
              onClick={() => confirm('Cancel this order?') && run(() => setFulfilmentStatus(db, order.id, 'cancelled'))}
            >
              Cancel order
            </button>
          ) : (
            <button type="button" className="button" onClick={() => run(() => setFulfilmentStatus(db, order.id, 'pending'))}>
              Reopen
            </button>
          )}
        </div>
      </section>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="actions actions--footer">
        <button type="button" className="button" onClick={() => navigate(`/orders/${order.id}/edit`)}>
          Edit
        </button>
        <button
          type="button"
          className="button button--danger"
          onClick={() =>
            confirm('Delete this order? This cannot be undone.') && run(() => deleteOrder(db, order.id).then(goBack))
          }
        >
          Delete
        </button>
      </div>
    </div>
  )
}
