import { useLiveQuery } from 'dexie-react-hooks'
import { useSyncExternalStore } from 'react'
import { resetRoute } from '../app/router'
import { useAuth } from '../auth/useAuth'
import { useDb } from '../orders/useDb'
import { useSync } from '../sync/useSync'

function subscribeOnline(callback: () => void) {
  window.addEventListener('online', callback)
  window.addEventListener('offline', callback)
  return () => {
    window.removeEventListener('online', callback)
    window.removeEventListener('offline', callback)
  }
}

/** Always-visible backup status (BUILD_PLAN.md §3). */
export function SyncIndicator() {
  const db = useDb()
  const { status, syncNow } = useSync()
  const { signOut } = useAuth()
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine)
  const waiting = useLiveQuery(() => db.orders.where('synced').equals(0).count(), [db], 0)
  const changes = `${waiting} ${waiting === 1 ? 'change' : 'changes'}`

  if (status === 'signin-required') {
    return (
      <div className="sync sync--attention" role="status">
        <span>{waiting > 0 ? `Sign in again to back up ${changes}.` : 'Sign in again to keep backing up.'}</span>
        <button
          type="button"
          className="sync__action"
          onClick={() => {
            // Orders stay on this phone and sync after signing in with the same email.
            resetRoute()
            void signOut()
          }}
        >
          Sign in
        </button>
      </div>
    )
  }

  let text: string
  let tone: 'ok' | 'waiting' | 'offline' | 'attention'
  if (!online || status === 'offline') {
    text = waiting > 0 ? `Offline · ${changes} saved on this phone` : 'Offline · all changes backed up'
    tone = 'offline'
  } else if (status === 'error') {
    text = `Couldn’t back up ${changes}. Retrying soon.`
    tone = 'attention'
  } else if (status === 'syncing') {
    text = 'Backing up…'
    tone = 'waiting'
  } else if (waiting > 0) {
    text = `${changes} waiting to back up`
    tone = 'waiting'
  } else {
    text = 'All changes backed up'
    tone = 'ok'
  }

  return (
    <div className={`sync sync--${tone}`} role="status">
      <span>{text}</span>
      {status === 'error' && (
        <button type="button" className="sync__action" onClick={syncNow}>
          Retry
        </button>
      )}
    </div>
  )
}
