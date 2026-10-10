import { createContext, useContext } from 'react'

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'signin-required' | 'error'

export interface SyncState {
  status: SyncStatus
  /** ISO time of the last successful sync on this device, or null. */
  lastSyncedAt: string | null
  /** Start a sync now (ignored while one is running; it re-runs afterwards). */
  syncNow: () => void
}

export const SyncContext = createContext<SyncState | null>(null)

export function useSync(): SyncState {
  const state = useContext(SyncContext)
  if (!state) throw new Error('useSync must be used inside <SyncProvider>')
  return state
}
