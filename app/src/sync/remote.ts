// Shapes shared by every synced table (orders now, payments next).

/** Sync state of a local record: 0 = changes not yet sent, 1 = in sync, 2 = rejected by the server. */
export type SyncState = 0 | 1 | 2

/** Fields every synced local record has. */
export interface SyncRecord {
  id: string
  /** ISO 8601, device clock. Drives "most recent change wins". */
  updated_at: string
  /** ISO 8601 when soft-deleted, otherwise null. */
  deleted_at: string | null
  /** Local only. Numeric so Dexie can index it. */
  synced: SyncState
  /** Local only: why the server rejected the last change (when synced = 2). */
  sync_error?: string | null
}

/** Fields every server row has. */
export interface RemoteRow {
  id: string
  updated_at: string
  deleted_at: string | null
  vendor_id?: string
  /** Server clock, set by the table's before-write trigger. Raw string to keep microseconds. */
  server_updated_at: string
}

/** A row as sent to the server: the server fills in vendor_id and server_updated_at. */
export type OutgoingRow<R extends RemoteRow> = Omit<R, 'server_updated_at' | 'vendor_id'>

/** One server table, as the sync engine sees it. Supabase in the app, an in-memory fake in unit tests. */
export interface RemoteTable<R extends RemoteRow> {
  /** Insert or update. The server silently skips rows older than what it holds. */
  push(rows: OutgoingRow<R>[]): Promise<void>
  /** Rows changed after `since` (exclusive), oldest first, at most `limit`. `since` null = from the start. */
  pull(since: string | null, limit: number): Promise<R[]>
}

/** The session is missing, expired beyond refresh, or for a different vendor: the vendor must sign in again. */
export class SyncAuthError extends Error {
  constructor(message = 'Sign in again to sync') {
    super(message)
    this.name = 'SyncAuthError'
  }
}

/** The server could not be reached. Try again later. */
export class SyncNetworkError extends Error {
  constructor(message = 'Server unreachable') {
    super(message)
    this.name = 'SyncNetworkError'
  }
}

/**
 * The server refused the data itself (e.g. a constraint or permission failure).
 * Retrying the same rows unchanged will fail again, so they are set aside.
 */
export class SyncRejectedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SyncRejectedError'
  }
}

/** Normalises a server timestamp to the app's ISO format (drops microseconds). */
export function toIso(timestamp: string): string {
  return new Date(timestamp).toISOString()
}
