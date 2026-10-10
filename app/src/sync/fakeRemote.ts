import {
  SyncDeferredError,
  SyncRejectedError,
  type DeletionPosition,
  type DeletionRecord,
  type OutgoingRow,
  type RemoteDeletions,
  type RemoteRow,
  type RemoteTable,
} from './remote'
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
  private readonly references: { field: keyof OutgoingRow<R>; rows: ReadonlyMap<string, unknown> } | null

  /**
   * @param references like a foreign key: rows whose `field` isn't an id in
   *   `rows` are refused as "not yet" (e.g. payments before their order).
   */
  constructor(
    immutable: readonly (keyof R)[] = ['created_at'],
    references: { field: keyof OutgoingRow<R>; rows: ReadonlyMap<string, unknown> } | null = null,
  ) {
    this.immutable = immutable
    this.references = references
  }

  async push(rows: OutgoingRow<R>[]): Promise<void> {
    this.pushCalls++
    if (this.failWith) throw this.failWith()
    const refused = rows.find((r) => this.rejectIds.has(r.id))
    if (refused) throw new SyncRejectedError(`new row for "${refused.id}" violates check constraint`)
    const { references } = this
    const orphan = references && rows.find((r) => !references.rows.has(String(r[references.field])))
    if (orphan) throw new SyncDeferredError(`23503: "${orphan.id}" violates foreign key constraint`)
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

/**
 * In-memory stand-in for public.deleted_records_since, for unit tests. Rows
 * deleted in one call share a deleted_at, like a cascade or a multi-row delete.
 */
export class FakeDeletions implements RemoteDeletions {
  readonly records: DeletionRecord[] = []
  calls = 0
  private clock = Date.parse('2026-10-10T08:30:00.000Z')

  /** Records rows of one table as hard-deleted together (same deleted_at). */
  record(table: string, ids: string[]): void {
    this.clock += 1
    const at = new Date(this.clock).toISOString()
    for (const id of ids) this.records.push({ table_name: table, record_id: id, deleted_at: at })
  }

  async since(after: DeletionPosition | null, limit: number): Promise<DeletionRecord[]> {
    this.calls++
    const key = (r: { at: string; table: string; id: string }) => [Date.parse(r.at), r.table, r.id] as const
    const isAfter = (r: DeletionRecord) => {
      if (!after) return true
      const [a1, a2, a3] = key({ at: r.deleted_at, table: r.table_name, id: r.record_id })
      const [b1, b2, b3] = key(after)
      return a1 !== b1 ? a1 > b1 : a2 !== b2 ? a2 > b2 : a3 > b3
    }
    // Plain (byte-wise) comparison, like the server's uuid ordering, and the same as isAfter.
    const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
    return this.records
      .filter(isAfter)
      .sort(
        (x, y) =>
          Date.parse(x.deleted_at) - Date.parse(y.deleted_at) ||
          cmp(x.table_name, y.table_name) ||
          cmp(x.record_id, y.record_id),
      )
      .slice(0, limit)
  }
}