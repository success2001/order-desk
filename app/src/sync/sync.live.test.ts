// Live sync tests against the real Supabase project (npm run test:live).
//
// Creates a temporary vendor directly in auth.users via the database connection
// in .env.supabase.local, signs it in on two simulated devices, syncs through
// the real API (PostgREST + RLS + orders_before_write trigger), then deletes the
// vendor, which also deletes its orders.

import 'fake-indexeddb/auto'
import { AuthClient, type GoTrueClient } from '@supabase/auth-js'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openOrderDb, type OrderDb } from '../orders/db'
import { createOrder, deleteOrder, getOrder, setFulfilmentStatus, updateOrder } from '../orders/repository'
import { SyncAuthError } from './remote'
import { createSupabaseRemote } from './supabaseRemote'
import { syncOnce } from './sync'
import { ordersTable, paymentsTable, type RemoteOrderRow, type RemotePaymentRow, type SyncTable } from './tables'
import { paidTotal, recordPayment } from '../payments/repository'

const API_URL = import.meta.env.VITE_SUPABASE_URL
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

function connect() {
  process.loadEnvFile('.env.supabase.local')
  const match = process.env.SUPABASE_DB_URL?.trim().match(/^(postgres(?:ql)?:\/\/[^:/]+:)(.*)@([^@]+)$/)
  if (!match) throw new Error('SUPABASE_DB_URL missing or malformed in .env.supabase.local')
  let password = match[2]
  try {
    password = decodeURIComponent(password)
  } catch {
    // not encoded
  }
  return postgres(`${match[1]}${encodeURIComponent(password)}@${match[3]}`, {
    ssl: 'require',
    max: 1,
    prepare: false,
    onnotice: () => {},
  })
}

const sql = connect()
const vendorId = crypto.randomUUID()
const email = `sync-live-${vendorId.slice(0, 8)}@example.invalid`
const password = `${crypto.randomUUID()}-Aa1!`
const dbs: OrderDb[] = []

function signedInClient(): GoTrueClient {
  return new AuthClient({
    url: `${API_URL}/auth/v1`,
    headers: { apikey: KEY },
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  })
}

async function device(): Promise<{ db: OrderDb; tables: SyncTable[] }> {
  const auth = signedInClient()
  const { error } = await auth.signInWithPassword({ email, password })
  if (error) throw error
  const db = openOrderDb(`live-${crypto.randomUUID()}`)
  dbs.push(db)
  const remote = createSupabaseRemote({ auth, vendorId, url: API_URL, key: KEY })
  return { db, tables: [ordersTable(remote<RemoteOrderRow>('orders')), paymentsTable(remote<RemotePaymentRow>('payments'))] }
}

const serverRow = async (id: string) =>
  (await sql`select * from public.orders where id = ${id}`)[0] as Record<string, unknown> | undefined

beforeAll(async () => {
  // Empty strings, not NULL, for the token columns: Supabase Auth cannot read NULLs there.
  await sql`
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', ${vendorId}, 'authenticated', 'authenticated', ${email},
      extensions.crypt(${password}, extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', '{}', now(), now(),
      '', '', '', ''
    )`
  await sql`
    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (${vendorId}, ${vendorId},
            ${sql.json({ sub: vendorId, email, email_verified: true })}, 'email', now(), now(), now())`
})

afterAll(async () => {
  await Promise.all(dbs.map((db) => db.delete()))
  await sql`delete from auth.users where id = ${vendorId}` // cascades to the vendor's orders
  // The cascade records each deleted order; remove this test vendor's records too.
  await sql`delete from private.deleted_records where vendor_id = ${vendorId}`
  const [{ n }] = await sql`select ((select count(*) from public.orders where vendor_id = ${vendorId})
    + (select count(*) from private.deleted_records where vendor_id = ${vendorId}))::int as n`
  await sql.end()
  expect(n).toBe(0)
})

describe('live sync with Supabase', () => {
  it('pushes a new order; the server sets the vendor and its own timestamp', async () => {
    const phone = await device()
    const order = await createOrder(phone.db, { customer_name: 'Ada', items: '2x gown', amount_due_kobo: 2_500_000 })

    const started = Date.now()
    await syncOnce(phone.db, phone.tables)
    const elapsed = Date.now() - started

    const row = await serverRow(order.id)
    expect(row?.vendor_id).toBe(vendorId)
    expect(row?.customer_name).toBe('Ada')
    expect(Number(row?.amount_due_kobo)).toBe(2_500_000)
    expect(row?.server_updated_at).toBeInstanceOf(Date)
    expect((await phone.db.orders.get(order.id))?.synced).toBe(1)
    // Acceptance criterion 3: changes reach the server within 30 s once online.
    expect(elapsed).toBeLessThan(30_000)
    console.log(`push + pull round trip: ${elapsed} ms`)
  })

  it('two devices converge on the most recent edit (acceptance criterion 4)', async () => {
    const phone = await device()
    const laptop = await device()
    const order = await createOrder(phone.db, { customer_name: 'Bayo', items: 'Small chops', amount_due_kobo: 1_850_050 })
    await syncOnce(phone.db, phone.tables)
    await syncOnce(laptop.db, laptop.tables)
    expect((await getOrder(laptop.db, order.id))?.customer_name).toBe('Bayo')

    // Laptop's edit is newer, but the phone sends its older edit last.
    const base = Date.now()
    await updateOrder(laptop.db, order.id, { items: 'laptop edit (newer)' }, new Date(base + 2_000))
    await updateOrder(phone.db, order.id, { items: 'phone edit (older)' }, new Date(base + 1_000))
    await syncOnce(laptop.db, laptop.tables)
    await syncOnce(phone.db, phone.tables)
    await syncOnce(laptop.db, laptop.tables)

    expect((await serverRow(order.id))?.items).toBe('laptop edit (newer)')
    expect((await getOrder(phone.db, order.id))?.items).toBe('laptop edit (newer)')
    expect((await getOrder(laptop.db, order.id))?.items).toBe('laptop edit (newer)')
    expect(await phone.db.orders.where('synced').equals(0).count()).toBe(0)
  })

  it('syncs deletions to the other device', async () => {
    const phone = await device()
    const laptop = await device()
    const order = await createOrder(phone.db, { customer_name: 'Chi', items: 'Wig', amount_due_kobo: 9_000_000 })
    await syncOnce(phone.db, phone.tables)
    await syncOnce(laptop.db, laptop.tables)

    await deleteOrder(phone.db, order.id)
    await syncOnce(phone.db, phone.tables)
    await syncOnce(laptop.db, laptop.tables)

    expect((await serverRow(order.id))?.deleted_at).toBeInstanceOf(Date)
    expect(await getOrder(laptop.db, order.id)).toBeUndefined()
  })

  it('sets aside a row the real server refuses, and still syncs the others', async () => {
    const phone = await device()
    const good = await createOrder(phone.db, { customer_name: 'Dayo', items: 'Shoes', amount_due_kobo: 1_000_000 })
    // Bypass the app's validation to simulate client/server rules drifting apart:
    // 201 characters breaks the database's customer_name check (max 200).
    const bad = await createOrder(phone.db, { customer_name: 'Too long', items: 'Bag', amount_due_kobo: 500_000 })
    await phone.db.orders.update(bad.id, { customer_name: 'x'.repeat(201) })

    const result = await syncOnce(phone.db, phone.tables)

    expect(result).toMatchObject({ pushed: 1, rejected: 1 })
    expect((await serverRow(good.id))?.customer_name).toBe('Dayo')
    expect(await serverRow(bad.id)).toBeUndefined()
    const stored = await phone.db.orders.get(bad.id)
    expect(stored?.synced).toBe(2)
    expect(stored?.sync_error).toMatch(/23514|check constraint/)
  })

  it('does not re-create an order hard-deleted on the server, and reports no error', async () => {
    const phone = await device()
    const order = await createOrder(phone.db, { customer_name: 'Efe', items: 'Perfume', amount_due_kobo: 3_000_000 })
    await syncOnce(phone.db, phone.tables)
    expect(await serverRow(order.id)).toBeDefined()

    // Deleted on the server (e.g. from the dashboard) while the phone still holds it.
    await sql`delete from public.orders where id = ${order.id}`
    await updateOrder(phone.db, order.id, { items: 'Perfume (edited offline)' })

    const result = await syncOnce(phone.db, phone.tables)

    expect(result.rejected).toBe(0)
    expect(await serverRow(order.id)).toBeUndefined()
    const [record] = await sql`select vendor_id from private.deleted_records where table_name = 'orders' and record_id = ${order.id}`
    expect(record?.vendor_id).toBe(vendorId)
  })

  it('delivered_at round-trips: set when delivered, cleared on reopen, on both devices', async () => {
    const phone = await device()
    const laptop = await device()
    const order = await createOrder(phone.db, { customer_name: 'Femi', items: 'Agbada', amount_due_kobo: 4_500_000 })
    const delivered = await setFulfilmentStatus(phone.db, order.id, 'delivered')
    await syncOnce(phone.db, phone.tables)

    expect(new Date((await serverRow(order.id))?.delivered_at as Date).toISOString()).toBe(delivered.delivered_at)
    await syncOnce(laptop.db, laptop.tables)
    expect((await getOrder(laptop.db, order.id))?.delivered_at).toBe(delivered.delivered_at)

    await setFulfilmentStatus(laptop.db, order.id, 'pending')
    await syncOnce(laptop.db, laptop.tables)
    await syncOnce(phone.db, phone.tables)

    expect((await serverRow(order.id))?.delivered_at).toBeNull()
    expect((await getOrder(phone.db, order.id))?.delivered_at).toBeNull()
  })

  it('payments recorded on two devices at the same time both reach the server and count', async () => {
    const phone = await device()
    const laptop = await device()
    const order = await createOrder(phone.db, { customer_name: 'Gbenga', items: 'Lace', amount_due_kobo: 6_000_000 })
    await syncOnce(phone.db, phone.tables)
    await syncOnce(laptop.db, laptop.tables)

    await recordPayment(phone.db, order.id, 2_000_000, { method: 'transfer' })
    await recordPayment(laptop.db, order.id, 1_500_000, { method: 'cash' })
    await syncOnce(phone.db, phone.tables)
    await syncOnce(laptop.db, laptop.tables)
    await syncOnce(phone.db, phone.tables)

    const [server] = await sql`select count(*)::int as n, sum(amount_kobo)::bigint as total from public.payments
      where order_id = ${order.id} and deleted_at is null`
    expect(server.n).toBe(2)
    expect(Number(server.total)).toBe(3_500_000)
    expect(await paidTotal(phone.db, order.id)).toBe(3_500_000)
    expect(await paidTotal(laptop.db, order.id)).toBe(3_500_000)
  })

  it('a payment whose order the server refused waits (deferred), it is not set aside', async () => {
    const phone = await device()
    const order = await createOrder(phone.db, { customer_name: 'Hauwa', items: 'Fabric', amount_due_kobo: 1_000_000 })
    const payment = await recordPayment(phone.db, order.id, 400_000)
    // Bypass the app's validation so the server refuses the order (name over 200 characters).
    await phone.db.orders.update(order.id, { customer_name: 'x'.repeat(201) })

    const result = await syncOnce(phone.db, phone.tables)

    expect(result).toMatchObject({ rejected: 1, deferred: 1 })
    expect(await phone.db.payments.get(payment.id)).toMatchObject({ synced: 0, sync_error: null })
  })

  it('a payment for an order deleted on the server is skipped silently', async () => {
    const phone = await device()
    const order = await createOrder(phone.db, { customer_name: 'Ifeoma', items: 'Bag', amount_due_kobo: 800_000 })
    await syncOnce(phone.db, phone.tables)
    await sql`delete from public.orders where id = ${order.id}`

    await recordPayment(phone.db, order.id, 800_000)
    const result = await syncOnce(phone.db, phone.tables)

    expect(result).toMatchObject({ rejected: 0, deferred: 0 })
    const [{ n }] = await sql`select count(*)::int as n from public.payments where order_id = ${order.id}`
    expect(n).toBe(0)
  })

  it('refuses to sync when the session belongs to a different vendor', async () => {
    const auth = signedInClient()
    await auth.signInWithPassword({ email, password })
    const wrong = createSupabaseRemote({ auth, vendorId: crypto.randomUUID(), url: API_URL, key: KEY })<RemoteOrderRow>('orders')
    await expect(wrong.pull(null, 10)).rejects.toBeInstanceOf(SyncAuthError)
  })

  it('reports sign-in required when there is no session', async () => {
    const remote = createSupabaseRemote({ auth: signedInClient(), vendorId, url: API_URL, key: KEY })<RemoteOrderRow>('orders')
    await expect(remote.pull(null, 10)).rejects.toBeInstanceOf(SyncAuthError)
  })
})
