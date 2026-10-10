// Shared helpers for the browser tests in e2e/.
// Uses the installed Chrome (playwright-core, no browser download).

import { AuthClient } from '@supabase/auth-js'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve } from 'node:path'
import { chromium } from 'playwright-core'
import postgres from 'postgres'
import { loadDbUrl } from '../scripts/dbUrl.mjs'

export const APP_DIR = resolve(import.meta.dirname, '..')

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

export function supabaseConfig() {
  process.loadEnvFile(join(APP_DIR, '.env.local'))
  const url = process.env.VITE_SUPABASE_URL
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
  return { url, key, storageKey: `sb-${new URL(url).hostname.split('.')[0]}-auth-token` }
}

export function connectDb() {
  const { url } = loadDbUrl(join(APP_DIR, '.env.supabase.local'))
  return postgres(url, { ssl: 'require', max: 1, prepare: false, onnotice: () => {} })
}

/**
 * Creates a temporary vendor directly in auth.users and signs it in with a password
 * (test-only; real vendors use email codes). Call remove() to delete it and its orders.
 */
export async function createTempVendor(sql, { url, key }) {
  const id = crypto.randomUUID()
  const email = `e2e-${id.slice(0, 8)}@example.invalid`
  const password = `${crypto.randomUUID()}-Aa1!`

  // Empty strings, not NULL, for the token columns: Supabase Auth cannot read NULLs there.
  await sql`
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', ${id}, 'authenticated', 'authenticated', ${email},
      extensions.crypt(${password}, extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '')`
  await sql`
    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (${id}, ${id}, ${sql.json({ sub: id, email, email_verified: true })}, 'email', now(), now(), now())`

  const auth = new AuthClient({ url: `${url}/auth/v1`, headers: { apikey: key }, persistSession: false, autoRefreshToken: false })
  const { data, error } = await auth.signInWithPassword({ email, password })
  if (error) {
    await sql`delete from auth.users where id = ${id}`
    throw error
  }

  return {
    account: { id, email },
    session: data.session,
    /** The vendor's order on the server, by customer name. */
    serverOrder: async (customerName) =>
      (await sql`select * from public.orders where vendor_id = ${id} and customer_name = ${customerName}`)[0],
    /** Total of the order's payments on the server that aren't voided, in kobo. */
    serverPaidTotal: async (customerName) => {
      const [row] = await sql`select coalesce(sum(p.amount_kobo), 0)::bigint as total, count(p.id)::int as payments
        from public.orders o left join public.payments p on p.order_id = o.id and p.deleted_at is null
        where o.vendor_id = ${id} and o.customer_name = ${customerName}`
      return { total: Number(row?.total ?? 0), payments: row?.payments ?? 0 }
    },
    async remove() {
      await sql`delete from auth.users where id = ${id}` // cascades to orders
      // The cascade records each deleted order; remove this test vendor's records too.
      await sql`delete from private.deleted_records where vendor_id = ${id}`
      const [{ n }] = await sql`select (select count(*) from public.orders where vendor_id = ${id})
        + (select count(*) from private.deleted_records where vendor_id = ${id}) as n`
      return Number(n) === 0
    },
  }
}

// ---------------------------------------------------------------------------
// Servers
// ---------------------------------------------------------------------------

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
}

/** Serves dist/ (run `npm run build` first). stop() takes the site down, to test offline start-up. */
export async function startProdServer(port) {
  const dist = normalize(join(APP_DIR, 'dist'))
  if (!existsSync(join(dist, 'index.html'))) throw new Error('dist/ not found: run `npm run build` first')
  const appUrl = `http://localhost:${port}/`
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, appUrl).pathname)
    const file = normalize(join(dist, path === '/' ? 'index.html' : path))
    if (!file.startsWith(dist) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end()
      return
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' })
    createReadStream(file).pipe(res)
  })
  await new Promise((done) => server.listen(port, done))
  let up = true
  return {
    url: appUrl,
    isUp: () => up,
    stop: () =>
      up
        ? new Promise((done) => {
            up = false
            server.closeAllConnections()
            server.close(done)
          })
        : Promise.resolve(),
  }
}

/** Starts the Vite dev server (React StrictMode on, no service worker). */
export async function startDevServer(port) {
  const { createServer: createVite } = await import('vite')
  const vite = await createVite({ root: APP_DIR, logLevel: 'error', server: { port, strictPort: true } })
  await vite.listen()
  let up = true
  return {
    url: `http://localhost:${port}/`,
    isUp: () => up,
    stop: async () => {
      if (!up) return
      up = false
      await vite.close()
    },
  }
}

// ---------------------------------------------------------------------------
// Browser
// ---------------------------------------------------------------------------

/** Phone-sized headless Chrome with result tracking. */
export async function openPhone({ shotsDir, isSiteUp = () => true }) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const context = await browser.newContext({
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'en-NG',
    timezoneId: 'Africa/Lagos',
  })
  context.setDefaultTimeout(10_000)
  const page = await context.newPage()
  const errors = []
  page.on('console', (m) => {
    // Failed requests while deliberately offline or with the site down are expected.
    if (m.type() === 'error' && isSiteUp() && !m.text().includes('ERR_INTERNET_DISCONNECTED')) errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('dialog', (d) => d.accept())

  const results = []
  return {
    browser,
    context,
    page,
    errors,
    results,
    check: (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail }),
    visible: (locator, timeout = 3000) => locator.first().waitFor({ timeout }).then(() => true, () => false),
    shot: (name) => (shotsDir ? page.screenshot({ path: join(shotsDir, `${name}.png`), fullPage: true }) : Promise.resolve()),
  }
}

/** Polls fn until it returns something truthy, or null after ms. */
export async function waitFor(fn, ms = 15_000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const value = await fn()
    if (value) return value
    await new Promise((r) => setTimeout(r, 500))
  }
  return null
}

export function report(title, results) {
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${title}`)
  for (const r of results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? ` (${r.detail})` : ''}`)
  console.log(`  ${results.length - failed.length} passed, ${failed.length} failed`)
  return failed.length === 0
}
