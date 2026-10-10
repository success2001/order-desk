// Acceptance criterion 7 (BUILD_PLAN.md §4) on the built app, under Chrome's
// mid-range phone simulation: CPU 4x slower, slow 4G (Lighthouse's mobile settings).
//
//   npm run test:perf     (builds first)
//
// Measures time until the orders list is on screen with 300 orders stored,
// on a first visit and on later visits (app cached by the service worker),
// checks Chrome's own installability verdict, and the compressed download size.

import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { chromium } from 'playwright-core'
import { APP_DIR, openPhone, report, startProdServer } from './support.mjs'

const LIMITS = { repeatOpenMs: 3000, jsKb: 200 }
const NETWORK = { offline: false, latency: 562.5, downloadThroughput: (1474.56 * 1024) / 8, uploadThroughput: (675 * 1024) / 8 }
const CPU_SLOWDOWN = 4
const ORDERS = 300
const VENDOR = { id: '44444444-4444-4444-8444-444444444444', email: 'perf@example.com' }

// Download size of what the app ships (JS and CSS, compressed).
const assets = join(APP_DIR, 'dist', 'assets')
const gzKb = (ext) =>
  readdirSync(assets)
    .filter((f) => f.endsWith(ext))
    .reduce((sum, f) => sum + gzipSync(readFileSync(join(assets, f))).length, 0) / 1024

const site = await startProdServer(4175)
const { browser, context, page, check, results } = await openPhone({})
const cdp = await context.newCDPSession(page)

async function throttle(on) {
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', on ? NETWORK : { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: on ? CPU_SLOWDOWN : 1 })
}

/** Navigates (or reloads) and returns ms until the first order row is visible. */
async function timeToList(navigate) {
  const started = Date.now()
  await navigate()
  await page.locator('.order-row').first().waitFor({ timeout: 30_000 })
  return Date.now() - started
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

try {
  // Signed-in vendor, so the app opens straight to the list.
  await context.addInitScript((v) => localStorage.setItem('account', JSON.stringify(v)), VENDOR)

  // Unthrottled set-up: create the database and store 300 orders.
  await page.goto(site.url)
  await page.getByText('No open orders.').waitFor()
  await page.evaluate(
    ([dbName, count]) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open(dbName)
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const tx = open.result.transaction('orders', 'readwrite')
          const store = tx.objectStore('orders')
          const base = Date.parse('2026-09-01T08:00:00Z')
          for (let i = 0; i < count; i++) {
            const ts = new Date(base + i * 3_600_000).toISOString()
            store.put({
              id: crypto.randomUUID(),
              customer_name: `Customer ${i}`,
              customer_phone: null,
              channel: i % 2 ? 'instagram' : 'whatsapp',
              items: `${(i % 5) + 1}x Ankara gown (L), head wrap`,
              amount_due_kobo: 2_500_000 + i * 100,
              amount_paid_kobo: i % 3 === 0 ? 0 : 1_000_000,
              fulfilment_status: ['pending', 'dispatched', 'delivered'][i % 3],
              notes: null,
              created_at: ts,
              updated_at: ts,
              deleted_at: null,
              synced: 1,
            })
          }
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error)
        }
      }),
    [`orders-${VENDOR.id}`, ORDERS],
  )
  await page.evaluate(() => navigator.serviceWorker.ready)

  // Installability, as Chrome itself judges it. Needs a normal (non-incognito) profile.
  const profileDir = mkdtempSync(join(tmpdir(), 'order-tracker-install-'))
  try {
    const persistent = await chromium.launchPersistentContext(profileDir, { channel: 'chrome', headless: true })
    const installPage = persistent.pages()[0] ?? (await persistent.newPage())
    await installPage.goto(site.url)
    await installPage.evaluate(() => navigator.serviceWorker.ready)
    const { installabilityErrors } = await (await persistent.newCDPSession(installPage)).send('Page.getInstallabilityErrors')
    check(
      'installable (Chrome reports no installability errors)',
      installabilityErrors.length === 0,
      installabilityErrors.map((e) => e.errorId).join(', '),
    )
    await persistent.close()
  } finally {
    rmSync(profileDir, { recursive: true, force: true })
  }

  // First visit: fresh browser context, nothing cached.
  const fresh = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true })
  await fresh.addInitScript((v) => localStorage.setItem('account', JSON.stringify(v)), VENDOR)
  const freshPage = await fresh.newPage()
  const freshCdp = await fresh.newCDPSession(freshPage)
  await freshCdp.send('Network.enable')
  await freshCdp.send('Network.emulateNetworkConditions', NETWORK)
  await freshCdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_SLOWDOWN })
  const firstStarted = Date.now()
  await freshPage.goto(site.url)
  await freshPage.getByText('No open orders.').waitFor({ timeout: 60_000 })
  const firstVisit = Date.now() - firstStarted
  await fresh.close()
  check('first visit, nothing cached (for information)', true, `${firstVisit} ms to usable screen`)

  // Later visits: app cached by the service worker, 300 orders stored.
  await throttle(true)
  const repeats = []
  for (let i = 0; i < 5; i++) repeats.push(await timeToList(() => page.reload()))
  check(
    `later visits open in < ${LIMITS.repeatOpenMs} ms with ${ORDERS} orders (median of 5)`,
    median(repeats) < LIMITS.repeatOpenMs,
    `${median(repeats)} ms; runs ${repeats.join(', ')}`,
  )

  // Later visit with no connection at all.
  await site.stop()
  await context.setOffline(true)
  const offline = await timeToList(() => page.reload())
  check(`offline visit opens in < ${LIMITS.repeatOpenMs} ms`, offline < LIMITS.repeatOpenMs, `${offline} ms`)
  await context.setOffline(false)
  await throttle(false)

  // Download size.
  const js = gzKb('.js')
  check(`JavaScript < ${LIMITS.jsKb} KB compressed`, js < LIMITS.jsKb, `${js.toFixed(1)} KB JS + ${gzKb('.css').toFixed(1)} KB CSS`)
} catch (err) {
  check('performance run completed', false, String(err).split('\n')[0])
} finally {
  await page.evaluate((name) => indexedDB.deleteDatabase(name), `orders-${VENDOR.id}`).catch(() => {})
  await browser.close()
  await site.stop()
}

process.exit(report(`Performance (CPU ${CPU_SLOWDOWN}x slower, slow 4G)`, results) ? 0 : 1)
