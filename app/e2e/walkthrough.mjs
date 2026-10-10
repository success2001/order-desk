// End-to-end walkthrough of the app in phone-sized headless Chrome, with real Supabase sync.
//
//   node e2e/walkthrough.mjs prod   built app (dist/), incl. offline start-up via the service worker
//   node e2e/walkthrough.mjs dev    Vite dev server (React StrictMode), no service worker steps
//
// Creates a temporary vendor in Supabase (deleted at the end). Screenshots: e2e/.screenshots/<mode>/.

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  APP_DIR,
  connectDb,
  createTempVendor,
  openPhone,
  report,
  startDevServer,
  startProdServer,
  supabaseConfig,
  waitFor,
} from './support.mjs'

const mode = process.argv[2]
if (mode !== 'prod' && mode !== 'dev') {
  console.error('Usage: node e2e/walkthrough.mjs <prod|dev>')
  process.exit(1)
}
const prod = mode === 'prod'

const config = supabaseConfig()
const sql = connectDb()
const vendor = await createTempVendor(sql, config)
const site = prod ? await startProdServer(4174) : await startDevServer(5174)
const shotsDir = join(APP_DIR, 'e2e', '.screenshots', mode)
mkdirSync(shotsDir, { recursive: true })
const { browser, context, page, errors, results, check, visible, shot } = await openPhone({ shotsDir, isSiteUp: site.isUp })

/** As if this vendor signed in earlier on this phone. A Supabase session is optional. */
const rememberVendor = (account, session = null) =>
  page.evaluate(
    ([a, key, s]) => {
      localStorage.setItem('account', JSON.stringify({ id: a.id, email: a.email }))
      if (s) localStorage.setItem(key, JSON.stringify(s))
    },
    [account, config.storageKey, session],
  )
const OTHER_VENDOR = { id: '22222222-2222-4222-8222-222222222222', email: 'vendor-b@example.com' }
const listReady = () => page.getByText('No open orders.').waitFor({ timeout: 15_000 })

try {
  // Sign-in screen when nobody is signed in.
  await page.goto(site.url)
  check('sign-in screen shown when signed out', await visible(page.getByRole('heading', { name: 'Sign in' }), 15_000))
  await page.getByLabel('Email address').fill('not-an-email')
  await page.getByRole('button', { name: 'Send code' }).click()
  check('invalid email rejected before sending', await visible(page.getByText('Enter a valid email address')))
  await context.setOffline(true)
  await page.getByLabel('Email address').fill('vendor@example.com')
  await page.getByRole('button', { name: 'Send code' }).click()
  check('offline sign-in explains connection needed', await visible(page.getByText(/No internet connection/)))
  await shot('00-signin-offline')
  await context.setOffline(false)

  // An old pre-"orderdesk-" database from a test install, holding an unsent order.
  await page.evaluate(
    (name) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open(name, 10) // Dexie version(1) is IndexedDB version 10
        open.onupgradeneeded = () => {
          open.result.createObjectStore('orders', { keyPath: 'id' }).createIndex('synced', 'synced')
          open.result.createObjectStore('meta', { keyPath: 'key' })
        }
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const tx = open.result.transaction('orders', 'readwrite')
          const now = new Date().toISOString()
          tx.objectStore('orders').put({
            id: crypto.randomUUID(), customer_name: 'Legacy Order', customer_phone: null, channel: 'whatsapp',
            items: 'old test data', amount_due_kobo: 100_000, amount_paid_kobo: 0, fulfilment_status: 'pending',
            notes: null, created_at: now, updated_at: now, deleted_at: null, synced: 0,
          })
          tx.oncomplete = () => (open.result.close(), resolve())
        }
      }),
    `orders-${vendor.account.id}`,
  )

  // Signed-in vendor with a real session.
  await rememberVendor(vendor.account, vendor.session)
  await page.reload()
  await listReady()
  if (prod) {
    await page.evaluate(() => navigator.serviceWorker.ready)
    if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) {
      await page.reload()
      await listReady()
    }
    check('service worker controls page', await page.evaluate(() => !!navigator.serviceWorker.controller))
  }
  check('banner: all changes backed up', await visible(page.getByText('All changes backed up'), 10_000))
  const dbNames = await waitFor(async () => {
    const names = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name))
    return names.some((n) => n.startsWith('orders-')) ? null : names
  }, 5_000)
  check('old "orders-" database removed on startup', dbNames, dbNames ? dbNames.join(', ') : 'still present')
  check('current database uses "orderdesk-" name', dbNames?.includes(`orderdesk-${vendor.account.id}`))
  check('unsent order in old database never uploaded', !(await vendor.serverOrder('Legacy Order')))
  check('old order not shown in the app', (await page.getByText('Legacy Order').count()) === 0)
  await shot('01-empty-list')

  // Validation.
  await page.getByRole('button', { name: '+ New order' }).click()
  await page.getByRole('button', { name: 'Save order' }).click()
  check('empty form shows amount error', await visible(page.getByText('Enter the amount, e.g. 25,000')))
  await page.getByLabel('Amount (₦)').fill('25,000')
  await page.getByRole('button', { name: 'Save order' }).click()
  check('missing name shows error', await visible(page.getByText('Enter the customer’s name.')))
  check('missing items shows error', await visible(page.getByText('Enter what was ordered.')))
  await shot('02-validation')

  // Create: saved on the phone, then reaches Supabase automatically.
  await page.getByLabel('Customer name').fill('Ada Okafor')
  await page.getByLabel('What did they order?').fill('2x Ankara gown (L)')
  await page.getByLabel('Amount (₦)').fill('₦25,000')
  await page.getByRole('button', { name: 'Instagram' }).click()
  const savedAt = Date.now()
  await page.getByRole('button', { name: 'Save order' }).click()
  check('order saved and shown in list', await visible(page.getByText('Ada Okafor')))
  check('list shows Unpaid + Not sent', (await visible(page.getByText('Unpaid'))) && (await visible(page.getByText('Not sent'))))
  const created = await waitFor(() => vendor.serverOrder('Ada Okafor'))
  check('order reached Supabase automatically', created, created ? `${Date.now() - savedAt} ms after save` : 'not found')
  check('server row has amount in kobo and channel', created && Number(created.amount_due_kobo) === 2_500_000 && created.channel === 'instagram')
  check('banner returns to all backed up', await visible(page.getByText('All changes backed up'), 10_000))
  await shot('03-list-one-order')

  // Part payment.
  await page.getByText('Ada Okafor').click()
  await page.getByRole('button', { name: 'Record part payment' }).click()
  await page.getByLabel('Amount received in naira').fill('10,000')
  await page.getByRole('button', { name: 'Add' }).click()
  await page.getByText('Part-paid').waitFor()
  check('part payment leaves ₦15,000 owed', (await page.locator('dd.owed').textContent()) === '₦15,000')
  check(
    'part payment synced',
    await waitFor(async () => Number((await vendor.serverOrder('Ada Okafor'))?.amount_paid_kobo) === 1_000_000),
  )
  await shot('04-detail-part-paid')

  // Delivery steps and full payment.
  await page.getByRole('button', { name: 'Mark dispatched' }).click()
  await page.getByText('Dispatched', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Mark fully paid' }).click()
  await page.getByText('Paid', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Mark delivered' }).click()
  await page.getByText('Delivered', { exact: true }).waitFor()
  check('not sent -> dispatched -> delivered, fully paid', await visible(page.getByRole('button', { name: 'Reopen' })))

  // Edit.
  await page.getByRole('button', { name: 'Edit' }).click()
  check('edit form prefilled', (await page.getByLabel('Amount (₦)').inputValue()) === '25000')
  await page.getByLabel('What did they order?').fill('3x Ankara gown (L)')
  await page.getByRole('button', { name: 'Save changes' }).click()
  check('edit saved and back on detail', await visible(page.getByText('3x Ankara gown (L)')))
  check(
    'edit and delivery status synced',
    await waitFor(async () => {
      const r = await vendor.serverOrder('Ada Okafor')
      return r?.items === '3x Ankara gown (L)' && r?.fulfilment_status === 'delivered'
    }),
  )

  // Completed orders hidden by default.
  await page.getByRole('button', { name: 'Back' }).click()
  check('delivered order hidden from open list', await visible(page.getByText('No open orders.')))
  await page.getByLabel('Show delivered and cancelled').check()
  check('delivered order shown with toggle', await visible(page.getByText('Ada Okafor')))
  await page.getByLabel('Show delivered and cancelled').uncheck()

  // No connection.
  if (prod) {
    await site.stop()
    await page.reload()
    check('app opens with site unreachable (service worker)', await visible(page.getByText('No open orders.')))
  }
  await context.setOffline(true)
  check('banner: offline', await visible(page.getByText(/^Offline/)))
  await page.getByRole('button', { name: '+ New order' }).click()
  check(
    'channel defaults to last used (Instagram)',
    (await page.getByRole('button', { name: 'Instagram' }).getAttribute('aria-pressed')) === 'true',
  )
  await page.getByLabel('Customer name').fill('Bayo')
  await page.getByLabel('What did they order?').fill('Small chops for 20')
  await page.getByLabel('Amount (₦)').fill('18500.50')
  await page.getByRole('button', { name: 'Save order' }).click()
  check('order saved while offline', await visible(page.getByText('₦18,500.50')))
  check('banner: offline with 1 change on phone', await visible(page.getByText('Offline · 1 change saved on this phone')))
  await page.waitForTimeout(4_000) // past the after-save delay
  check('offline order not sent while offline', !(await vendor.serverOrder('Bayo')))
  await shot('06-offline-list')

  // Connection back: the offline order syncs.
  await context.setOffline(false)
  const bayo = await waitFor(() => vendor.serverOrder('Bayo'))
  check('offline order synced when connection returned', bayo)
  check('amount stored exactly in kobo', Number(bayo?.amount_due_kobo) === 1_850_050)
  check('banner back to all backed up', await visible(page.getByText('All changes backed up'), 10_000))

  // Back button, then delete (synced as a soft delete).
  await page.getByText('Bayo').click()
  await page.getByRole('button', { name: 'Edit' }).waitFor()
  await page.goBack()
  check('browser back returns to list', await visible(page.getByText('Bayo')))
  await page.getByText('Bayo').click()
  await page.getByRole('button', { name: 'Delete' }).click()
  await page.getByText('No open orders.').waitFor()
  check('delete removes order from list', (await page.getByText('Bayo').count()) === 0)
  check('delete synced as soft delete', await waitFor(async () => (await vendor.serverOrder('Bayo'))?.deleted_at))

  // A change made elsewhere (directly on the server) shows up in the app.
  const ada = await vendor.serverOrder('Ada Okafor')
  await sql`update public.orders set notes = 'Changed on laptop', updated_at = now() where id = ${ada.id}`
  await page.getByRole('button', { name: 'Account' }).click()
  check('account page shows email', await visible(page.getByText(vendor.account.email)))
  check('account page shows last backup', !(await visible(page.getByText('Not yet on this visit'), 1000)))
  await shot('07-account')
  await page.goBack()
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))) // app back in foreground
  await page.getByLabel('Show delivered and cancelled').check()
  await page.getByText('Ada Okafor').click()
  check('server-side change pulled into the app', await visible(page.getByText('Changed on laptop'), 10_000))
  await page.getByRole('button', { name: 'Back' }).click()
  await page.getByLabel('Show delivered and cancelled').uncheck()

  // Sign-out works offline; another vendor on the phone sees none of these orders.
  await context.setOffline(true)
  await page.getByRole('button', { name: 'Account' }).click()
  await page.getByRole('button', { name: 'Sign out' }).click()
  check('sign-out works offline, back to sign-in', await visible(page.getByRole('heading', { name: 'Sign in' })))
  check('sign-out resets page to orders list', (await page.evaluate(() => location.hash)) === '#/')
  await context.setOffline(false)

  await rememberVendor(OTHER_VENDOR)
  await page.reload()
  await page.getByLabel('Show delivered and cancelled').check()
  check('other vendor sees none of these orders', await visible(page.getByText('No orders yet.')))
  check('no server session: banner asks to sign in again', await visible(page.getByText('Sign in again to keep backing up.'), 10_000))
  await shot('08-signin-required')
  await page.getByRole('button', { name: 'Account' }).click()
  await page.getByRole('button', { name: 'Sign out' }).click()
  await page.getByRole('heading', { name: 'Sign in' }).waitFor()

  // Original vendor signs back in: orders still on the phone. Dark mode render.
  await rememberVendor(vendor.account, vendor.session)
  await page.reload()
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.getByLabel('Show delivered and cancelled').check()
  check('orders kept after sign-out and back in', await visible(page.getByText('Ada Okafor')))
  await shot('09-dark-list')
} catch (err) {
  check('walkthrough completed', false, String(err).split('\n')[0])
  await shot('99-failure').catch(() => {})
} finally {
  check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '))
  await browser.close()
  await site.stop()
  check('temporary vendor and orders removed', await vendor.remove())
  await sql.end()
}

process.exit(report(`Walkthrough (${mode})`, results) ? 0 : 1)
