import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { navigate } from '../app/router'
import { formatOrderDate } from '../orders/labels'
import { formatKobo } from '../orders/money'
import { balanceKobo } from '../orders/payment'
import { listOrders } from '../orders/repository'
import { useDb } from '../orders/useDb'
import { paidTotals } from '../payments/repository'
import { FulfilmentBadge, PaymentBadge } from './Badges'

export function OrdersList() {
  const db = useDb()
  const [includeCompleted, setIncludeCompleted] = useState(false)
  const orders = useLiveQuery(() => listOrders(db, { includeCompleted }), [db, includeCompleted])
  const paid = useLiveQuery(() => paidTotals(db), [db])

  return (
    <>
      <label className="toggle">
        <input
          type="checkbox"
          checked={includeCompleted}
          onChange={(e) => setIncludeCompleted(e.target.checked)}
        />
        Show delivered and cancelled
      </label>

      {orders === undefined ? null : orders.length === 0 ? (
        <p className="empty">
          {includeCompleted ? 'No orders yet.' : 'No open orders.'} Tap <strong>New order</strong> to add one.
        </p>
      ) : (
        <ul className="order-list">
          {orders.map((order) => {
            const paidKobo = paid?.get(order.id) ?? 0
            const balance = balanceKobo(order.amount_due_kobo, paidKobo)
            return (
              <li key={order.id}>
                <button type="button" className="order-row" onClick={() => navigate(`/orders/${order.id}`)}>
                  <span className="order-row__top">
                    <span className="order-row__name">{order.customer_name}</span>
                    <span className="order-row__amount">{formatKobo(order.amount_due_kobo)}</span>
                  </span>
                  <span className="order-row__items">{order.items}</span>
                  <span className="order-row__bottom">
                    <PaymentBadge order={order} paid={paidKobo} />
                    <FulfilmentBadge order={order} />
                    {order.synced === 2 && <span className="badge badge--rejected">Not backed up</span>}
                    {balance > 0 && balance < order.amount_due_kobo && (
                      <span className="order-row__balance">{formatKobo(balance)} left</span>
                    )}
                    <span className="order-row__date">{formatOrderDate(order.created_at)}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <button type="button" className="fab" onClick={() => navigate('/new')}>
        + New order
      </button>
    </>
  )
}
