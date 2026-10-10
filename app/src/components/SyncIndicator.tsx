import { useSyncExternalStore } from 'react'
import { resetRoute } from '../app/router'
import { useAuth } from '../auth/useAuth'
import { useSync } from '../sync/useSync'

function subscribeOnline(callback: () => void) {
  window.addEventListener('online', callback)
  window.addEventListener('offline', callback)
  return () => {
    window.removeEventListener('online', callback)
    window.removeEventListener('offline', callback)
  }
}

const plural = (n: number) => `${n} ${n === 1 ? 'change' : 'changes'}`

/** Always-visible backup status (BUILD_PLAN.md §3). */
//fixed to /** Shows backup status only when attention is needed. */
export function SyncIndicator() {
  const { status, waiting, rejected, syncNow } = useSync()
  const { signOut } = useAuth()
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine)

  if (status === 'signin-required') {
    const notBackedUp = waiting + rejected
    return (
      <div className="sync sync--attention" role="status">
        <span>{notBackedUp > 0 ? `Sign in again to back up ${plural(notBackedUp)}.` : 'Sign in again to keep backing up.'}</span>
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
  
  if (online && status === 'idle' && waiting === 0 && rejected === 0) {
    return null
  }

  let text: string
  let tone: 'ok' | 'waiting' | 'offline' | 'attention'
  if (!online || status === 'offline') {
    text = waiting > 0 ? `Offline · ${plural(waiting)} saved on this phone` : 'Offline · all changes backed up'
    tone = 'offline'
  } else if (rejected > 0) {
    // Set aside by the server; editing the order sends it again.
    text = `${plural(rejected)} couldn’t be backed up. Open the order marked “Not backed up”.`
    tone = 'attention'
  } else if (status === 'error') {
    text = `Couldn’t back up ${plural(waiting)}. Retrying soon.`
    tone = 'attention'
  } else if (status === 'syncing') {
    text = 'Backing up…'
    tone = 'waiting'
  } else if (waiting > 0) {
    text = `${plural(waiting)} waiting to back up`
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
