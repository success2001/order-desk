import { useLiveQuery } from 'dexie-react-hooks'
import { resetRoute } from '../app/router'
import { useAuth } from '../auth/useAuth'
import { formatOrderDate } from '../orders/labels'
import { useDb } from '../orders/useDb'
import { useSync } from '../sync/useSync'

export function AccountPage() {
  const { account, signOut } = useAuth()
  const { lastSyncedAt } = useSync()
  const db = useDb()
  const waiting = useLiveQuery(() => db.orders.where('synced').equals(0).count(), [db], 0)

  function handleSignOut() {
    const message =
      waiting > 0
        ? `${waiting} ${waiting === 1 ? 'change hasn’t' : 'changes haven’t'} been backed up yet. ` +
          'They stay on this phone and will be backed up when you sign in again with this email.\n\nSign out?'
        : 'Sign out?'
    if (confirm(message)) {
      // The next person to sign in should start on the orders list, not this page.
      resetRoute()
      void signOut()
    }
  }

  return (
    <div className="detail">
      <section className="card">
        <h3>Signed in as</h3>
        <p className="prewrap">{account?.email}</p>
        <h3>Last backed up</h3>
        <p>{lastSyncedAt ? formatOrderDate(lastSyncedAt) : 'Not yet on this visit'}</p>
      </section>
      <div className="actions">
        <button type="button" className="button button--danger" onClick={handleSignOut}>
          Sign out
        </button>
      </div>
    </div>
  )
}
