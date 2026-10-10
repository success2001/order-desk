import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openOrderDb, type OrderDb } from '../orders/db'
import { createOrder, deleteOrder, getOrder, listOrders, setFulfilmentStatus, updateOrder } from '../orders/repository'
import type { NewOrderInput } from '../orders/types'
import { FakeDeletions, FakeRemote } from './fakeRemote'
import { SyncNetworkError, SyncRejectedError } from './remote'
import { PULL_PAGE, applyDeletions, cursorKey, pullChanges, pushChanges, syncOnce } from './sync'
import { ordersTable, paymentsTable, toRemoteOrder as toRemote, type RemotePaymentRow } from './tables'
import { paidTotal, recordPayment, voidPayment } from '../payments/repository'

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
const push = async (db: OrderDb) => (await pushChanges(db, ordersTable(remote))).confirmed
const pull = (db: OrderDb) => pullChanges(db, ordersTable(remote))
const sync = (db: OrderDb) => syncOnce(db, [ordersTable(remote)])

describe('push', () => {
  it('sends unsynced orders and marks them synced', async () => {
    const order = await createOrder(phone, input, T0)
    expect(await push(phone)).toBe(1)

    expect(remote.rows.get(order.id)?.customer_name).toBe('Ada')
    expect(await unsynced(phone)).toBe(0)
  })

  it('does nothing when there is nothing to send', async () => {
    expect(await push(phone)).toBe(0)
    expect(remote.pushCalls).toBe(0)
  })

  it('sends in batches when there are many changes', async () => {
    for (let i = 0; i < 450; i++) await createOrder(phone, { ...input, customer_name: `C${i}` }, at(i))
    expect(await push(phone)).toBe(450)
    expect(remote.pushCalls).toBe(3) // 200 + 200 + 50
    expect(remote.rows.size).toBe(450)
  })

  it('keeps an order unsynced if it was edited while the push was in flight', async () => {
    const order = await createOrder(phone, input, T0)
    remote.duringPush = async () => {
      remote.duringPush = null
      await updateOrder(phone, order.id, { items: 'edited mid-sync' }, at(1_000))
    }

    await push(phone)

    // The mid-sync edit went out in a second round rather than being lost.
    expect(remote.pushCalls).toBe(2)
    expect(remote.rows.get(order.id)?.items).toBe('edited mid-sync')
    expect(await unsynced(phone)).toBe(0)
  })

  it('leaves orders unsynced when the server is unreachable', async () => {
    await createOrder(phone, input, T0)
    remote.failWith = () => new SyncNetworkError()

    await expect(push(phone)).rejects.toBeInstanceOf(SyncNetworkError)
    expect(await unsynced(phone)).toBe(1)
  })
})

describe('pull', () => {
  it('adds orders created on another device, already marked synced', async () => {
    const other = device()
    const order = await createOrder(other, input, T0)
    await sync(other)

    expect(await pull(phone)).toBe(1)
    expect(await getOrder(phone, order.id)).toMatchObject({ customer_name: 'Ada', synced: 1 })
  })

  it('replaces an in-sync local copy with a newer server version', async () => {
    const order = await createOrder(phone, input, T0)
    await sync(phone)
    remote.serverWrite({ ...toRemote(order), items: 'changed elsewhere', updated_at: at(60_000).toISOString() })

    await pull(phone)
    expect((await getOrder(phone, order.id))?.items).toBe('changed elsewhere')
  })

  it('keeps unsent local changes that are newer than the server version', async () => {
    const order = await createOrder(phone, input, T0)
    await sync(phone)
    remote.serverWrite({ ...toRemote(order), items: 'older server edit', updated_at: at(1_000).toISOString() })
    await updateOrder(phone, order.id, { items: 'newer local edit' }, at(2_000))

    await pull(phone)
    const local = await getOrder(phone, order.id)
    expect(local?.items).toBe('newer local edit')
    expect(local?.synced).toBe(0)
  })

  it('lets a newer server version win over older unsent local changes', async () => {
    const order = await createOrder(phone, input, T0)
    await sync(phone)
    await updateOrder(phone, order.id, { items: 'older local edit' }, at(1_000))
    remote.serverWrite({ ...toRemote(order), items: 'newer server edit', updated_at: at(2_000).toISOString() })

    await pull(phone)
    const local = await getOrder(phone, order.id)
    expect(local?.items).toBe('newer server edit')
    expect(local?.synced).toBe(1)
  })

  it('only fetches changes since the last pull (with a small overlap)', async () => {
    const other = device()
    await createOrder(other, input, T0)
    await sync(other)
    await pull(phone)

    // Nothing new: the overlap re-reads the same row but changes nothing locally.
    expect(await pull(phone)).toBe(0)
  })

  it('pages through more rows than fit in one request', async () => {
    const other = device()
    for (let i = 0; i < PULL_PAGE + 25; i++) await createOrder(other, { ...input, customer_name: `C${i}` }, at(i))
    await sync(other)

    await pull(phone)
    expect(await phone.orders.count()).toBe(PULL_PAGE + 25)
  })

  it('stores timestamps from the server in the app format', async () => {
    const other = device()
    const order = await createOrder(other, input, T0)
    remote.serverWrite({ ...toRemote(order), updated_at: '2026-10-10T09:00:05.123456+00:00' })

    await pull(phone)
    expect((await phone.orders.get(order.id))?.updated_at).toBe('2026-10-10T09:00:05.123Z')
  })

  it('sends and receives delivered_at', async () => {
    const other = device()
    const order = await createOrder(other, input, T0)
    await setFulfilmentStatus(other, order.id, 'delivered', at(1_000))
    await sync(other)
    expect(remote.rows.get(order.id)?.delivered_at).toBe(at(1_000).toISOString())

    remote.serverWrite({
      ...toRemote((await other.orders.get(order.id))!),
      delivered_at: '2026-10-10T09:00:07.654321+00:00',
      updated_at: at(9_000).toISOString(),
    })
    await pull(phone)
    expect((await phone.orders.get(order.id))?.delivered_at).toBe('2026-10-10T09:00:07.654Z')
  })
})

describe('two devices, one vendor', () => {
  it('converge on the most recent edit regardless of sync order', async () => {
    const laptop = device()
    const order = await createOrder(phone, input, T0)
    await sync(phone)
    await sync(laptop)

    // Laptop edits later, but phone syncs its older edit last.
    await updateOrder(laptop, order.id, { items: 'laptop edit (newer)' }, at(20_000))
    await updateOrder(phone, order.id, { items: 'phone edit (older)' }, at(10_000))
    await sync(laptop)
    await sync(phone)
    await sync(laptop)

    expect((await getOrder(phone, order.id))?.items).toBe('laptop edit (newer)')
    expect((await getOrder(laptop, order.id))?.items).toBe('laptop edit (newer)')
    expect(remote.rows.get(order.id)?.items).toBe('laptop edit (newer)')
    expect(await unsynced(phone)).toBe(0)
  })

  it('sync deletions to the other device', async () => {
    const laptop = device()
    const order = await createOrder(phone, input, T0)
    await sync(phone)
    await sync(laptop)

    await deleteOrder(phone, order.id, at(5_000))
    await sync(phone)
    await sync(laptop)

    expect(await getOrder(laptop, order.id)).toBeUndefined()
    expect(await listOrders(laptop, { includeCompleted: true })).toEqual([])
    expect(remote.rows.get(order.id)?.deleted_at).toBe(at(5_000).toISOString())
  })

  it('a phone with a slow clock can still update an order last edited elsewhere', async () => {
    const laptop = device()
    const order = await createOrder(laptop, input, at(60_000))
    await sync(laptop)
    await sync(phone)

    // Phone clock is a minute behind the laptop's.
    await updateOrder(phone, order.id, { items: 'phone edit' }, T0)
    await sync(phone)
    await sync(laptop)

    expect(remote.rows.get(order.id)?.items).toBe('phone edit')
    expect((await getOrder(laptop, order.id))?.items).toBe('phone edit')
  })
})

describe('rejected rows', () => {
  it('sets aside only the row the server refuses; the rest still sync', async () => {
    const good1 = await createOrder(phone, { ...input, customer_name: 'Good 1' }, T0)
    const bad = await createOrder(phone, { ...input, customer_name: 'Bad' }, at(1))
    const good2 = await createOrder(phone, { ...input, customer_name: 'Good 2' }, at(2))
    remote.rejectIds.add(bad.id)

    const result = await sync(phone)

    expect(result).toMatchObject({ pushed: 2, rejected: 1 })
    expect(remote.rows.has(good1.id)).toBe(true)
    expect(remote.rows.has(good2.id)).toBe(true)
    expect(remote.rows.has(bad.id)).toBe(false)
    const stored = await phone.orders.get(bad.id)
    expect(stored?.synced).toBe(2)
    expect(stored?.sync_error).toMatch(/violates check constraint/)
    // Kept on the phone and still visible to the vendor.
    expect((await getOrder(phone, bad.id))?.customer_name).toBe('Bad')
  })

  it('does not resend a rejected row until it is edited, then retries it', async () => {
    const bad = await createOrder(phone, input, T0)
    remote.rejectIds.add(bad.id)
    await sync(phone)
    const callsAfterRejection = remote.pushCalls

    await sync(phone)
    expect(remote.pushCalls).toBe(callsAfterRejection) // nothing resent

    remote.rejectIds.delete(bad.id)
    const edited = await updateOrder(phone, bad.id, { items: 'fixed' }, at(1_000))
    expect(edited).toMatchObject({ synced: 0, sync_error: null })
    await sync(phone)

    expect(remote.rows.get(bad.id)?.items).toBe('fixed')
    expect((await phone.orders.get(bad.id))?.synced).toBe(1)
  })

  it('a newer server version replaces a rejected local change', async () => {
    const order = await createOrder(phone, input, T0)
    await sync(phone)
    remote.rejectIds.add(order.id)
    await updateOrder(phone, order.id, { items: 'refused edit' }, at(1_000))
    await sync(phone)
    expect((await phone.orders.get(order.id))?.synced).toBe(2)

    remote.serverWrite({ ...toRemote(order), items: 'newer elsewhere', updated_at: at(5_000).toISOString() })
    await pull(phone)

    expect(await phone.orders.get(order.id)).toMatchObject({ items: 'newer elsewhere', synced: 1, sync_error: null })
  })

  it('network failures are not treated as rejections', async () => {
    await createOrder(phone, input, T0)
    remote.failWith = () => new SyncNetworkError()

    await expect(sync(phone)).rejects.toBeInstanceOf(SyncNetworkError)
    expect(await unsynced(phone)).toBe(1)
    expect(await phone.orders.where('synced').equals(2).count()).toBe(0)
  })

  it('a rejection that affects every row sets them all aside without looping', async () => {
    for (let i = 0; i < 3; i++) {
      const order = await createOrder(phone, { ...input, customer_name: `C${i}` }, at(i))
      remote.rejectIds.add(order.id)
    }

    const result = await sync(phone)

    expect(result).toMatchObject({ pushed: 0, rejected: 3 })
    expect(remote.pushCalls).toBe(4) // one batch + one retry per row
    expect(await unsynced(phone)).toBe(0)
  })

  it('a rejection on fetch is reported, not swallowed', async () => {
    remote.failWith = () => new SyncRejectedError('permission denied for table orders')
    await expect(pull(phone)).rejects.toBeInstanceOf(SyncRejectedError)
  })
})

describe('several tables', () => {
  it('pushes every table before pulling, in the given order', async () => {
    await createOrder(phone, input, T0)
    const calls: string[] = []
    const spy = (label: string) => ({
      push: async (rows: unknown[]) => void calls.push(`push:${label}:${rows.length}`),
      pull: async () => (calls.push(`pull:${label}`), []),
    })

    await syncOnce(phone, [
      { ...ordersTable(remote), name: 'first', remote: spy('first') },
      { ...ordersTable(remote), name: 'second', remote: spy('second') },
    ])

    // "second" has nothing left to push: "first" already sent the shared local rows.
    expect(calls).toEqual(['push:first:1', 'pull:first', 'pull:second'])
  })

  it('keeps a separate fetch cursor per table', async () => {
    const other = device()
    await createOrder(other, input, T0)
    await sync(other)

    await pull(phone)

    expect((await phone.meta.get(cursorKey(ordersTable(remote))))?.key).toBe('pullCursor:orders')
    expect(await phone.meta.get('pullCursor')).toBeUndefined()
  })
})
describe('payments', () => {
  let payRemote: FakeRemote<RemotePaymentRow>
  const both = () => [ordersTable(remote), paymentsTable(payRemote)]
  const syncAll = (db: OrderDb) => syncOnce(db, both())

  beforeEach(() => {
    // Like the server's foreign key: a payment needs its order to be on the server.
    payRemote = new FakeRemote<RemotePaymentRow>(['created_at', 'order_id'], { field: 'order_id', rows: remote.rows })
  })

  it('syncs an order and its payments to another device', async () => {
    const order = await createOrder(phone, input, T0)
    await recordPayment(phone, order.id, 1_000_000, { method: 'transfer' }, at(1_000))

    expect(await syncAll(phone)).toMatchObject({ pushed: 2, rejected: 0, deferred: 0 })
    const laptop = device()
    await syncAll(laptop)

    expect(await paidTotal(laptop, order.id)).toBe(1_000_000)
    expect((await laptop.payments.toArray())[0]).toMatchObject({ method: 'transfer', synced: 1 })
  })

  it('keeps payments recorded on two devices at the same time (both count)', async () => {
    const laptop = device()
    const order = await createOrder(phone, input, T0)
    await syncAll(phone)
    await syncAll(laptop)

    // Both record a payment before either syncs.
    await recordPayment(phone, order.id, 1_000_000, {}, at(1_000))
    await recordPayment(laptop, order.id, 500_000, {}, at(1_000))
    await syncAll(phone)
    await syncAll(laptop)
    await syncAll(phone)

    expect(payRemote.rows.size).toBe(2)
    expect(await paidTotal(phone, order.id)).toBe(1_500_000)
    expect(await paidTotal(laptop, order.id)).toBe(1_500_000)
  })

  it('syncs a voided payment so it stops counting everywhere', async () => {
    const laptop = device()
    const order = await createOrder(phone, input, T0)
    const payment = await recordPayment(phone, order.id, 1_000_000, {}, at(1_000))
    await syncAll(phone)
    await syncAll(laptop)

    await voidPayment(laptop, payment.id, at(2_000))
    await syncAll(laptop)
    await syncAll(phone)

    expect(await paidTotal(phone, order.id)).toBe(0)
    expect(payRemote.rows.get(payment.id)?.deleted_at).toBe(at(2_000).toISOString())
  })

  it('a payment whose order is not on the server waits instead of being set aside', async () => {
    const order = await createOrder(phone, input, T0)
    const payment = await recordPayment(phone, order.id, 1_000_000, {}, at(1_000))
    remote.rejectIds.add(order.id) // the order itself is refused, so it never reaches the server

    const result = await syncAll(phone)

    expect(result).toMatchObject({ rejected: 1, deferred: 1 })
    expect((await phone.orders.get(order.id))?.synced).toBe(2)
    expect(await phone.payments.get(payment.id)).toMatchObject({ synced: 0, sync_error: null })
    expect(payRemote.pushCalls).toBe(2) // one batch + one single retry: no looping

    // Once the order is fixed and synced, the waiting payment goes through.
    remote.rejectIds.delete(order.id)
    await updateOrder(phone, order.id, { items: 'fixed' }, at(2_000))
    expect(await syncAll(phone)).toMatchObject({ pushed: 2, rejected: 0, deferred: 0 })
    expect(payRemote.rows.has(payment.id)).toBe(true)
    expect((await phone.payments.get(payment.id))?.synced).toBe(1)
  })
})
describe('hard deletes on the server', () => {
  let payRemote: FakeRemote<RemotePaymentRow>
  let deletions: FakeDeletions
  const both = () => [ordersTable(remote), paymentsTable(payRemote)]

  beforeEach(() => {
    payRemote = new FakeRemote<RemotePaymentRow>(['created_at', 'order_id'], { field: 'order_id', rows: remote.rows })
    deletions = new FakeDeletions()
  })

  /** Like deleting an order in the dashboard: its payments go with it (cascade). */
  function deleteOnServer(orderId: string) {
    const paymentIds = [...payRemote.rows.values()].filter((p) => p.order_id === orderId).map((p) => p.id)
    remote.rows.delete(orderId)
    paymentIds.forEach((id) => payRemote.rows.delete(id))
    deletions.record('orders', [orderId])
    if (paymentIds.length) deletions.record('payments', paymentIds)
  }

  it('removes an order and its payments from a device that already has them', async () => {
    const order = await createOrder(phone, input, T0)
    await recordPayment(phone, order.id, 1_000_000, {}, at(1_000))
    await syncOnce(phone, both(), deletions)

    deleteOnServer(order.id)
    const result = await syncOnce(phone, both(), deletions)

    expect(result.removed).toBe(2)
    expect(await phone.orders.get(order.id)).toBeUndefined()
    expect(await phone.payments.count()).toBe(0)
    expect(await paidTotal(phone, order.id)).toBe(0)
  })

  it('removes the row even if the device has unsent changes to it (the server would skip them)', async () => {
    const order = await createOrder(phone, input, T0)
    await syncOnce(phone, both(), deletions)
    deleteOnServer(order.id)
    remote.rejectIds.add(order.id) // stand-in for the server skipping or refusing the edit
    await updateOrder(phone, order.id, { items: 'edited after deletion' }, at(5_000))

    await syncOnce(phone, both(), deletions)

    expect(await phone.orders.get(order.id)).toBeUndefined()
  })

  it('does not skip rows deleted together across a page boundary', async () => {
    const ids: string[] = []
    for (let i = 0; i < 5; i++) ids.push((await createOrder(phone, { ...input, customer_name: `C${i}` }, at(i))).id)
    await syncOnce(phone, both(), deletions)
    ids.forEach((id) => remote.rows.delete(id))
    deletions.record('orders', ids) // all five share one deleted_at

    const removed = await applyDeletions(phone, both(), deletions, 2) // pages of 2

    expect(removed).toBe(5)
    expect(await phone.orders.count()).toBe(0)
  })

  it('remembers where it got to, and re-reading recent deletions is harmless', async () => {
    const order = await createOrder(phone, input, T0)
    await syncOnce(phone, both(), deletions)
    deleteOnServer(order.id)
    expect(await applyDeletions(phone, both(), deletions)).toBe(1)

    expect(await applyDeletions(phone, both(), deletions)).toBe(0)
    expect(JSON.parse((await phone.meta.get('deletionsCursor'))!.value)).toMatchObject({ table: 'orders', id: order.id })
  })

  it('ignores deletions for tables this device does not sync, and of rows it never had', async () => {
    await createOrder(phone, input, T0)
    deletions.record('orders', ['never-on-this-phone'])
    deletions.record('something_else', ['x'])

    expect(await applyDeletions(phone, both(), deletions)).toBe(0)
    expect(await phone.orders.count()).toBe(1)
  })

  it('is skipped when no deletion source is given', async () => {
    await createOrder(phone, input, T0)
    expect((await syncOnce(phone, both())).removed).toBe(0)
    expect(deletions.calls).toBe(0)
  })
})