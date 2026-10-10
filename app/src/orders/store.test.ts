import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openOrderDb, vendorDbName } from './db'
import { createOrder } from './repository'
import { deleteLegacyDatabases, isLegacyDbName } from './store'

const USER = '11111111-1111-4111-8111-111111111111'
const input = { customer_name: 'Ada', items: '2x gown', amount_due_kobo: 2_500_000 }

async function existing(): Promise<string[]> {
  return (await indexedDB.databases()).map((d) => d.name ?? '').sort()
}

/** Creates a database with an unsent order in it, like an old test install. */
async function seed(name: string): Promise<void> {
  const db = openOrderDb(name)
  await createOrder(db, input)
  db.close()
}

afterEach(async () => {
  vi.restoreAllMocks()
  for (const name of await existing()) await Dexie.delete(name)
})

describe('isLegacyDbName', () => {
  it('matches only the old "orders-" names', () => {
    expect(isLegacyDbName('orders-device')).toBe(true)
    expect(isLegacyDbName(`orders-${USER}`)).toBe(true)
    expect(isLegacyDbName(vendorDbName(USER))).toBe(false)
    expect(isLegacyDbName('something-else')).toBe(false)
  })
})

describe('vendorDbName', () => {
  it('uses the "orderdesk-" prefix', () => {
    expect(vendorDbName(USER)).toBe(`orderdesk-${USER}`)
  })
})

describe('deleteLegacyDatabases', () => {
  it('deletes every old database, including unsent changes, and keeps current ones', async () => {
    await seed('orders-device')
    await seed(`orders-${USER}`)
    await seed('orders-22222222-2222-4222-8222-222222222222')
    await seed(vendorDbName(USER))
    await seed('unrelated-app-db')

    const deleted = await deleteLegacyDatabases()

    expect(deleted.sort()).toEqual(
      ['orders-22222222-2222-4222-8222-222222222222', 'orders-device', `orders-${USER}`].sort(),
    )
    expect(await existing()).toEqual([vendorDbName(USER), 'unrelated-app-db'])
  })

  it('leaves the current database and its orders intact', async () => {
    await seed(vendorDbName(USER))
    await seed(`orders-${USER}`)

    await deleteLegacyDatabases()

    const db = openOrderDb(vendorDbName(USER))
    expect(await db.orders.count()).toBe(1)
    db.close()
  })

  it('falls back to known names when the browser cannot list databases', async () => {
    await seed('orders-device')
    await seed(`orders-${USER}`)
    await seed('orders-not-known-here')
    vi.spyOn(indexedDB, 'databases').mockRejectedValue(new TypeError('not supported'))

    const deleted = await deleteLegacyDatabases([USER])

    vi.restoreAllMocks()
    expect(deleted.sort()).toEqual(['orders-device', `orders-${USER}`].sort())
    expect(await existing()).toEqual(['orders-not-known-here'])
  })

  it('does nothing when there is nothing to delete', async () => {
    expect(await deleteLegacyDatabases()).toEqual([])
  })
})
