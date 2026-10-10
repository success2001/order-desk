import { SyncRejectedError, type OutgoingRow, type RemoteRow, type RemoteTable } from './remote'
import type { RemoteOrderRow } from './tables'

/**
 * In-memory stand-in for one server table, for unit tests. Mirrors the
 * before-write triggers: stale or duplicate writes are skipped, accepted writes
 * get an increasing server_updated_at, and immutable fields keep their first value.
 */
export class FakeRemote<R extends RemoteRow & { created_at: string } = RemoteOrderRow> implements RemoteTable<R> {
  readonly rows = new Map<string, R>()
  pushCalls = 0
  /** Set to make the next calls fail, e.g. () => new SyncNetworkError(). */
  failWith: (() => Error) | null = null
  /** Rows with these ids are refused, and so is any batch containing them (like a constraint failure). */
  readonly rejectIds = new Set<string>()
  /** Runs during push, after the request is "sent" — to simulate edits made mid-sync. */
  duringPush: (() => Promise<void>) | null = null
  private clock = Date.parse('2026-10-10T08:00:00.000Z')
  private readonly immutable: readonly (keyof R)[]

  constructor(immutable: readonly (keyof R)[] = ['created_at']) {
    this.immutable = immutable
  }

  async push(rows: OutgoingRow<R>[]): Promise<void> {
    this.pushCalls++
    if (this.failWith) throw this.failWith()
    const refused = rows.find((r) => this.rejectIds.has(r.id))
    if (refused) throw new SyncRejectedError(`new row for "${refused.id}" violates check constraint`)
    const snapshot = rows.map((r) => ({ ...r }))
    if (this.duringPush) await this.duringPush()
    for (const row of snapshot) {
      const existing = this.rows.get(row.id)
      if (existing && Date.parse(row.updated_at) <= Date.parse(existing.updated_at)) continue
      const next = { ...row, server_updated_at: this.tick() } as R
      if (existing) for (const field of this.immutable) next[field] = existing[field]
      this.rows.set(row.id, next)
    }
  }

  async pull(since: string | null, limit: number): Promise<R[]> {
    if (this.failWith) throw this.failWith()
    return [...this.rows.values()]
      .filter((r) => since === null || Date.parse(r.server_updated_at) > Date.parse(since))
      .sort((a, b) => Date.parse(a.server_updated_at) - Date.parse(b.server_updated_at) || a.id.localeCompare(b.id))
      .slice(0, limit)
      .map((r) => ({ ...r }))
  }

  /** Simulates another device's write landing on the server directly. */
  serverWrite(row: OutgoingRow<R>): void {
    this.rows.set(row.id, { ...row, server_updated_at: this.tick() } as R)
  }

  private tick(): string {
    this.clock += 1
    return new Date(this.clock).toISOString()
  }
}
