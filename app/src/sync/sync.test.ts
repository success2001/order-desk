import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openOrderDb, type OrderDb } from '../orders/db'
import { createOrder, deleteOrder, getOrder, listOrders, updateOrder } from '../orders/repository'
import type { NewOrderInput } from '../orders/types'
import { FakeRemote } from './fakeRemote'
import { SyncNetworkError, toRemote } from './remote'
import { PULL_PAGE, pullChanges, pushChanges, syncOnce } from './sync'

const T0 = new Date('2026-10-10T09:00:00.000Z')
const at = (ms: number) => new Date(T0.getTime() + ms)
const input: NewOrderInput = { customer_name: 'Ada', items: '2x Ankara gown', amount_due_kobo: 2_500_000 }

const dbs: OrderDb[] = []
function device(): OrderDb {
  const db = openOrderDb(`sync-test-${crypto.randomUUID()}`)
  dbs.push(db)
  return db
}

let remote: FakeRemote
let phone: OrderDb

beforeEach(() => {
  remote = new FakeRemote()
  phone = device()
})

afterEach(async () => {
  await Promise.all(dbs.splice(0).map((db) => db.delete()))
})

const unsynced = (db: OrderDb) => db.orders.where('synced').equals(0).count()

describe('push', () => {
  it('sends unsynced orders and marks them synced', async () => {
    const order = await createOrder(phone, input, T0)
    expect(await pushChanges(phone, remote)).toBe(1)

    expect(remote.rows.get(order.id)?.customer_name).toBe('Ada')
    expect(await unsynced(phone)).toBe(0)
  })

  it('does nothing when there is nothing to send', async () => {
    expect(await pushChanges(phone, remote)).toBe(0)
    expect(remote.pushCalls).toBe(0)
  })

  it('sends in batches when there are many changes', async () => {
    for (let i = 0; i < 450; i++) await createOrder(phone, { ...input, customer_name: `C${i}` }, at(i))
    expect(await pushChanges(phone, remote)).toBe(450)
    expect(remote.pushCalls).toBe(3) // 200 + 200 + 50
    expect(remote.rows.size).toBe(450)
  })

  it('keeps an order unsynced if it was edited while the push was in flight', async () => {
    const order = await createOrder(phone, input, T0)
    remote.duringPush = async () => {
      remote.duringPush = null
      await updateOrder(phone, order.id, { items: 'edited mid-sync' }, at(1_000))
    }

    await pushChanges(phone, remote)

    // The mid-sync edit went out in a second round rather than being lost.
    expect(remote.pushCalls).toBe(2)
    expect(remote.rows.get(order.id)?.items).toBe('edited mid-sync')
    expect(await unsynced(phone)).toBe(0)
  })

  it('leaves orders unsynced when the server is unreachable', async () => {
    await createOrder(phone, input, T0)
    remote.failWith = () => new SyncNetworkError()

    await expect(pushChanges(phone, remote)).rejects.toBeInstanceOf(SyncNetworkError)
    expect(await unsynced(phone)).toBe(1)
  })
})

describe('pull', () => {
  it('adds orders created on another device, already marked synced', async () => {
    const other = device()
    const order = await createOrder(other, input, T0)
    await syncOnce(other, remote)

    expect(await pullChanges(phone, remote)).toBe(1)
    expect(await getOrder(phone, order.id)).toMatchObject({ customer_name: 'Ada', synced: 1 })
  })

  it('replaces an in-sync local copy with a newer server version', async () => {
    const order = await createOrder(phone, input, T0)
    await syncOnce(phone, remote)
    remote.serverWrite({ ...toRemote(order), items: 'changed elsewhere', updated_at: at(60_000).toISOString() })

    await pullChanges(phone, remote)
    expect((await getOrder(phone, order.id))?.items).toBe('changed elsewhere')
  })

  it('keeps unsent local changes that are newer than the server version', async () => {
    const order = await createOrder(phone, input, T0)
    await syncOnce(phone, remote)
    remote.serverWrite({ ...toRemote(order), items: 'older server edit', updated_at: at(1_000).toISOString() })
    await updateOrder(phone, order.id, { items: 'newer local edit' }, at(2_000))

    await pullChanges(phone, remote)
    const local = await getOrder(phone, order.id)
    expect(local?.items).toBe('newer local edit')
    expect(local?.synced).toBe(0)
  })

  it('lets a newer server version win over older unsent local changes', async () => {
    const order = await createOrder(phone, input, T0)
    await syncOnce(phone, remote)
    await updateOrder(phone, order.id, { items: 'older local edit' }, at(1_000))
    remote.serverWrite({ ...toRemote(order), items: 'newer server edit', updated_at: at(2_000).toISOString() })

    await pullChanges(phone, remote)
    const local = await getOrder(phone, order.id)
    expect(local?.items).toBe('newer server edit')
    expect(local?.synced).toBe(1)
  })

  it('only fetches changes since the last pull (with a small overlap)', async () => {
    const other = device()
    await createOrder(other, input, T0)
    await syncOnce(other, remote)
    await pullChanges(phone, remote)

    // Nothing new: the overlap re-reads the same row but changes nothing locally.
    expect(await pullChanges(phone, remote)).toBe(0)
  })

  it('pages through more rows than fit in one request', async () => {
    const other = device()
    for (let i = 0; i < PULL_PAGE + 25; i++) await createOrder(other, { ...input, customer_name: `C${i}` }, at(i))
    await syncOnce(other, remote)

    await pullChanges(phone, remote)
    expect(await phone.orders.count()).toBe(PULL_PAGE + 25)
  })

  it('stores timestamps from the server in the app format', async () => {
    const other = device()
    const order = await createOrder(other, input, T0)
    remote.serverWrite({ ...toRemote(order), updated_at: '2026-10-10T09:00:05.123456+00:00' })

    await pullChanges(phone, remote)
    expect((await phone.orders.get(order.id))?.updated_at).toBe('2026-10-10T09:00:05.123Z')
  })
})

describe('two devices, one vendor', () => {
  it('converge on the most recent edit regardless of sync order', async () => {
    const laptop = device()
    const order = await createOrder(phone, input, T0)
    await syncOnce(phone, remote)
    await syncOnce(laptop, remote)

    // Laptop edits later, but phone syncs its older edit last.
    await updateOrder(laptop, order.id, { items: 'laptop edit (newer)' }, at(20_000))
    await updateOrder(phone, order.id, { items: 'phone edit (older)' }, at(10_000))
    await syncOnce(laptop, remote)
    await syncOnce(phone, remote)
    await syncOnce(laptop, remote)

    expect((await getOrder(phone, order.id))?.items).toBe('laptop edit (newer)')
    expect((await getOrder(laptop, order.id))?.items).toBe('laptop edit (newer)')
    expect(remote.rows.get(order.id)?.items).toBe('laptop edit (newer)')
    expect(await unsynced(phone)).toBe(0)
  })

  it('sync deletions to the other device', async () => {
    const laptop = device()
    const order = await createOrder(phone, input, T0)
    await syncOnce(phone, remote)
    await syncOnce(laptop, remote)

    await deleteOrder(phone, order.id, at(5_000))
    await syncOnce(phone, remote)
    await syncOnce(laptop, remote)

    expect(await getOrder(laptop, order.id)).toBeUndefined()
    expect(await listOrders(laptop, { includeCompleted: true })).toEqual([])
    expect(remote.rows.get(order.id)?.deleted_at).toBe(at(5_000).toISOString())
  })

  it('a phone with a slow clock can still update an order last edited elsewhere', async () => {
    const laptop = device()
    const order = await createOrder(laptop, input, at(60_000))
    await syncOnce(laptop, remote)
    await syncOnce(phone, remote)

    // Phone clock is a minute behind the laptop's.
    await updateOrder(phone, order.id, { items: 'phone edit' }, T0)
    await syncOnce(phone, remote)
    await syncOnce(laptop, remote)

    expect(remote.rows.get(order.id)?.items).toBe('phone edit')
    expect((await getOrder(laptop, order.id))?.items).toBe('phone edit')
  })
})
