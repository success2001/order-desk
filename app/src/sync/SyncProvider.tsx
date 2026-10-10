import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useDb } from '../orders/useDb'
import type { OrderDb } from '../orders/db'
import { SyncAuthError, SyncNetworkError, type SyncState as RecordSyncState } from './remote'
import { syncOnce } from './sync'
import type { SyncTable } from './tables'
import { SyncContext, type SyncStatus } from './useSync'

const AFTER_SAVE_MS = 3_000
const INTERVAL_MS = 5 * 60_000
const RETRY_MS = [30_000, 60_000, 2 * 60_000, 5 * 60_000]

/**
 * Runs sync (BUILD_PLAN.md §3): on start, when the connection returns, when the
 * app comes back to the foreground, a few seconds after each save, and every
 * 5 minutes. Only one sync runs at a time; requests during a sync re-run it after.
 * Background Sync is not used (not supported everywhere).
 */
export function SyncProvider({ tables, children }: { tables: readonly SyncTable[]; children: ReactNode }) {
  const db = useDb()
  const [status, setStatus] = useState<SyncStatus>('idle')
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null)
  const running = useRef(false)
  const rerun = useRef(false)
  const failures = useRef(0)
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // Lets a scheduled retry call the latest syncNow without syncNow referring to itself.
  const syncNowRef = useRef<() => Promise<void>>(async () => {})

  const syncNow = useCallback(async () => {
    if (running.current) {
      rerun.current = true
      return
    }
    clearTimeout(retryTimer.current)
    if (!navigator.onLine) {
      setStatus('offline')
      return
    }

    running.current = true
    setStatus('syncing')
    try {
      do {
        rerun.current = false
        await syncOnce(db, tables)
      } while (rerun.current)
      failures.current = 0
      setStatus('idle')
      setLastSyncedAt(new Date().toISOString())
    } catch (err) {
      if (err instanceof SyncAuthError) {
        // Retrying won't help until the vendor signs in again.
        setStatus('signin-required')
      } else {
        setStatus(err instanceof SyncNetworkError ? 'offline' : 'error')
        if (!(err instanceof SyncNetworkError)) console.error('Sync failed', err)
        const delay = RETRY_MS[Math.min(failures.current, RETRY_MS.length - 1)]
        failures.current++
        retryTimer.current = setTimeout(() => void syncNowRef.current(), delay)
      }
    } finally {
      running.current = false
    }
  }, [db, tables])

  useEffect(() => {
    syncNowRef.current = syncNow
  }, [syncNow])

  // Start, connection changes, foreground, and a periodic safety net.
  useEffect(() => {
    // Deferred like the other triggers, rather than setting state during the effect itself.
    const initial = setTimeout(() => void syncNow(), 0)
    const onOnline = () => void syncNow()
    const onOffline = () => setStatus('offline')
    const onVisible = () => document.visibilityState === 'visible' && void syncNow()
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    document.addEventListener('visibilitychange', onVisible)
    const interval = setInterval(() => void syncNow(), INTERVAL_MS)
    return () => {
      clearTimeout(initial)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(interval)
      clearTimeout(retryTimer.current)
    }
  }, [syncNow])

  // A few seconds after local changes (debounced, so quick successive edits go together).
  const waiting = useLiveQuery(() => countInState(db, tables, 0), [db, tables], 0)
  const rejected = useLiveQuery(() => countInState(db, tables, 2), [db, tables], 0)
  useEffect(() => {
    if (waiting === 0) return
    const timer = setTimeout(() => void syncNow(), AFTER_SAVE_MS)
    return () => clearTimeout(timer)
  }, [waiting, syncNow])

  const value = useMemo(
    () => ({ status, lastSyncedAt, waiting, rejected, syncNow: () => void syncNow() }),
    [status, lastSyncedAt, waiting, rejected, syncNow],
  )
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>
}

/** Records across all synced tables in the given sync state. */
async function countInState(db: OrderDb, tables: readonly SyncTable[], state: RecordSyncState): Promise<number> {
  const counts = await Promise.all(tables.map((t) => t.local(db).where('synced').equals(state).count()))
  return counts.reduce((sum, n) => sum + n, 0)
}
