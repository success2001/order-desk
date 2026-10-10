import type { RemoteOrderRow, RemoteOrders } from './remote'

/**
 * In-memory stand-in for public.orders, for unit tests. Mirrors the
 * orders_before_write trigger: stale or duplicate writes are skipped, accepted
 * writes get an increasing server_updated_at, created_at never changes.
 */
export class FakeRemote implements RemoteOrders {
  readonly rows = new Map<string, RemoteOrderRow>()
  pushCalls = 0
  /** Set to make the next calls fail, e.g. () => new SyncNetworkError(). */
  failWith: (() => Error) | null = null
  /** Runs during push, after the request is "sent" — to simulate edits made mid-sync. */
  duringPush: (() => Promise<void>) | null = null
  private clock = Date.parse('2026-10-10T08:00:00.000Z')

  async push(rows: Omit<RemoteOrderRow, 'server_updated_at'>[]): Promise<void> {
    this.pushCalls++
    if (this.failWith) throw this.failWith()
    const snapshot = rows.map((r) => ({ ...r }))
    if (this.duringPush) await this.duringPush()
    for (const row of snapshot) {
      const existing = this.rows.get(row.id)
      if (existing && Date.parse(row.updated_at) <= Date.parse(existing.updated_at)) continue
      this.rows.set(row.id, {
        ...row,
        created_at: existing?.created_at ?? row.created_at,
        server_updated_at: this.tick(),
      })
    }
  }

  async pull(since: string | null, limit: number): Promise<RemoteOrderRow[]> {
    if (this.failWith) throw this.failWith()
    return [...this.rows.values()]
      .filter((r) => since === null || Date.parse(r.server_updated_at) > Date.parse(since))
      .sort((a, b) => Date.parse(a.server_updated_at) - Date.parse(b.server_updated_at) || a.id.localeCompare(b.id))
      .slice(0, limit)
      .map((r) => ({ ...r }))
  }

  /** Simulates another device's write landing on the server directly. */
  serverWrite(row: Omit<RemoteOrderRow, 'server_updated_at'>): void {
    this.rows.set(row.id, { ...row, server_updated_at: this.tick() })
  }

  private tick(): string {
    this.clock += 1
    return new Date(this.clock).toISOString()
  }
}
