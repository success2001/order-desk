# Build Plan: Order Tracker (Version 1)

**Status:** Plan for review. No code written yet.
**Date:** 2026-10-09
**Related:** `PROJECT_BRIEF.md`: target user (§1), MVP features (§7) and out of scope (§9). The business is **not validated**. This build goes ahead knowing that.

---

## 1. Decisions So Far

| # | Decision | Choice |
|---|---|---|
| D1 | Platform | Mobile-first PWA (installable web app) |
| D2 | Connectivity | Offline-first: log orders offline, sync when online |
| D3 | Sign-in | Email with a 6-digit code (not magic links), for a cheap early pilot |
| D4 | Accounts | One vendor per account, with no team members or roles |
| D5 | Stack | React + TypeScript + Vite, vite-plugin-pwa, Dexie (IndexedDB), Supabase (Postgres + Auth), Cloudflare Pages |
| D6 | Node runtime | Portable Node 24.21.0 in `.tools/node`, used only by this workspace (system Node 16 untouched) |
| D7 | Layout and tooling | App code lives in `app/`. Code-style checks use oxlint (the Vite template's default) instead of ESLint. `npm run check` = lint + test + build. |
| D8 | Database workflow | Migrations in `app/supabase/migrations`, applied with `npm run db:push` (Supabase command-line tool, session-pooler connection string in `app/.env.supabase.local`, no access token). SQL tests in `app/supabase/tests`, run with `npm run db:test`. |
| D9 | Sign-in state | The app remembers the signed-in vendor (ID and email) on the device and decides "signed in" from that, not from the Supabase session. supabase-js reports no session when it's offline and the 1-hour token has expired, which would lock vendors out of their own orders. The session is only needed for sync. Sign-out is device-only, so it works offline. One on-device database per vendor (`orders-<user id>`). The app deliberately ignores supabase-js sign-in and sign-out events: a delayed SIGNED_OUT from an offline sign-out could otherwise sign out the next vendor. |
| D11 | Sync engine | Push, then pull. An order is marked synced only if it wasn't edited while the push was in flight. Each pull re-reads 10 s before the last cursor to catch late commits. Server changes never overwrite newer unsent local edits. Sync refuses to run if the session belongs to a different vendor. Runs on start, when the connection returns, when the app returns to the foreground, 3 s after saves and every 5 min, retrying after 30 s, 1, 2 and then 5 min. Live tests (`npm run test:live`) create and delete a temporary vendor via the database connection. |
| D13 | Hard deletes | Every hard delete on the server, whether from the dashboard, SQL or an account deletion cascade, is recorded in `private.deleted_records` by an after-delete trigger. Inserting a recorded id is **silently skipped**, so a device still holding a deleted row can't re-create it, and isn't left with a "not backed up" error. The `private` schema isn't exposed through the API; vendors can only ask "was this id deleted?" via `private.is_deleted_record`. Tests remove their own records. |
| D14 | On-phone database name | `orderdesk-<user id>` (`vendorDbName` in `db.ts`). On startup, all earlier `orders-*` databases (test data only) are deleted, unsent changes included, so they can never be uploaded. If the browser can't list its databases, the app deletes `orders-device` and the signed-in vendor's old name instead. Later schema changes add a new `db.version(n)` rather than renaming. |
| D15 | Delivery date | `orders.delivered_at` is set when an order **becomes** delivered, kept while it stays delivered, cleared when it leaves delivered (reopen, cancel, back to dispatched), and set again on re-delivery, so an order counts in the month of its latest delivery. The app sets it (`deliveredAt` in `repository.ts`). The server trigger enforces the same rule as a safeguard for older app versions, plus a check constraint (`NOT VALID`). The on-phone database is now version 2 (`delivered_at` index and an upgrade that fills it in). Migration `20261010130000` also adds `unique (id, vendor_id)` for the payments foreign key. |
| D16 | Payments | One row per payment received in `public.payments` (migration `20261010140000`), so revenue is counted by when money arrived and concurrent payments on two devices both survive. Rules (decided 2026-10-10): amount > ₦0 and ≤ ₦1bn; `paid_at` backdated at most 90 days before the payment was recorded, never future (reset to server time); payments on cancelled orders count until **voided** (`deleted_at`), which is also how refunds are recorded; optional `method` (transfer, cash, pos, other). A two-column foreign key `(order_id, vendor_id)` ties each payment to an order of the same vendor; payments are deleted with their order. Same sync rules, security rules and deleted-ID guard as orders. The paid total will be **calculated** from payments (task 8); `orders.amount_paid_kobo` stays until a final cleanup migration. |
| D17 | Payments in the app | `src/payments/`: `addPayment`, `voidPayment`, `recordPayment`, `markFullyPaid` (pays exactly the balance, or nothing if already paid), `createOrderWithPayment` (new order + its first payment in one transaction), `paidTotal` / `paidTotals`. Validation mirrors the server. "Paid" is always **calculated**; the app no longer reads or writes `orders.amount_paid_kobo`. On-phone database v3 adds `payments` and turns any stored paid amount into one payment whose id is the order's id, so it's identical on every device. Payments sync **after** orders. A foreign-key error (`23503`, e.g. a payment whose order isn't on the server) is **deferred**: left waiting and retried on later syncs, never set aside. |
| D18 | Payment screens | `PaymentsCard` on the order page: totals, "Mark fully paid" (only while something is owed), "Record payment" (amount, date received, optional method), and the payment history, newest first, with **Void** (confirmed). The date picker allows today and the previous 89 days. Today records the current time; earlier days record noon local time, so a time zone can't move a payment to another day, and the 90-day server limit is never hit (`payments/dates.ts`). |
| D19 | Dashboard figures | Calculated on the device (works offline), in **Lagos time** (UTC+1, no daylight saving, decided 2026-10-10) so every device agrees (`analytics/time.ts`, `analytics/dashboard.ts`). **Orders**: created in the period, excluding deleted and cancelled. **Revenue**: payments by `paid_at`, excluding voided ones and those on deleted orders; payments on cancelled orders count. **Delivered**: currently delivered with `delivered_at` in the period. **Awaiting delivery**: not sent or dispatched, any age. **Outstanding**: still owed on orders that aren't cancelled; overpayments don't offset other orders. **Comparison**: month to date against the same days of last month, clamped to its length. **Trend**: the last 14 Lagos days. **Breakdown**: delivery and payment status of this month's orders. |
| D12 | Browser tests | `e2e/` uses playwright-core with the installed Chrome. `test:e2e` runs the walkthrough on the production build **and** the dev server, since the dev server's React StrictMode exposed a bug the production build hid. `test:perf` checks criterion 7 under Chrome's phone throttling. |
| D10 | Supabase client | `@supabase/auth-js` + `@supabase/postgrest-js` instead of `@supabase/supabase-js` (27 KB vs 53 KB compressed; we don't use realtime, storage or functions). |

## 2. Build Order

| Step | Scope | Brief §7 features |
|---|---|---|
| **1. Core order log** ← *this plan* | Sign-in, create and edit orders, payment status, fulfilment status, offline sync | 1, 2, 3 |
| 2. Overview | Filtered lists, daily and weekly totals | 4 |
| 3. WhatsApp hand-off | Order summary that can be copied into WhatsApp | 5 |

Steps 2 and 3 get their own plans after step 1 ships.

---

## 3. Step 1 Scope

### Data model

**`orders`** (one table, in Supabase and mirrored in Dexie on the device)

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | Generated on the device so orders can be created offline |
| `vendor_id` | UUID | The signed-in user, set by the server |
| `customer_name` | text, required | |
| `customer_phone` | text, optional | Personal data, so collect only if useful |
| `channel` | `whatsapp` \| `instagram` \| `other` | Defaults to the last channel used |
| `items` | text, required | Free text, e.g. "2× Ankara gown (L), 1× head wrap". No line items in V1. |
| `amount_due_kobo` | integer, required | Stored in kobo to avoid rounding errors and shown as ₦ |
| `amount_paid_kobo` | integer, default 0 | |
| `fulfilment_status` | `pending` \| `dispatched` \| `delivered` \| `cancelled` | Defaults to `pending` |
| `notes` | text, optional | Delivery address, landmarks, etc. |
| `created_at` / `updated_at` | timestamp | Set on the device |
| `deleted_at` | timestamp, nullable | Soft delete, so deletions also sync |
| `server_updated_at` | timestamp | Set by the server and used to fetch only changes since the last sync |

**Payment status is calculated, not stored**, so it can never disagree with the amounts:
- `unpaid`: `amount_paid` = 0
- `part-paid`: 0 < `amount_paid` < `amount_due`
- `paid`: `amount_paid` ≥ `amount_due`

### Screens

1. **Sign in:** enter email, then the 6-digit code. This needs a connection the first time only.
2. **Orders list:** open orders (not delivered or cancelled) first, newest first. Each row shows the customer, amount, payment badge and fulfilment badge. A simple "Show completed" toggle. Proper filters and totals come in step 2.
3. **New order:** a short form with customer name, items and amount as the only required fields. Must be quick to fill in.
4. **Order detail:** one-tap actions such as "Mark fully paid", "Record part payment" and "Mark dispatched" → "Mark delivered". Also edit, cancel and delete (with confirmation).
5. **Sync indicator** (always visible): *Offline*, *N changes waiting*, or *All changes saved*.

### Sync rules

- **The device is the source of truth for the screen.** Every action saves to Dexie immediately, and the UI never waits for the network.
- **Sending changes:** changed orders are marked as unsynced and sent to Supabase in batches.
- **Receiving changes:** fetch orders where `server_updated_at` is newer than the last fetch.
- **Conflicts:** the most recent change wins, using `updated_at`. The server applies a change only if it is newer than what it already holds.
- **When sync runs:** on app start, when the connection returns, a few seconds after each save, and every 5 minutes while the app is open. We won't rely on Background Sync, which isn't supported everywhere.
- **Storage protection:** ask the browser to keep stored data permanently, so Android doesn't clear unsynced orders when the phone runs low on space.

### Security

- Row-level security in Supabase means a vendor can only read and write rows where `vendor_id` matches their own account.
- The public Supabase key is the only key in the app. The admin (service) key never goes in the app.

---

## 4. Acceptance Criteria (Step 1)

Step 1 is done when **all** of these pass:

1. **Speed of entry:** a first-time tester can save a new order in **≤ 30 seconds**.
2. **Works offline:** after the first sign-in, in airplane mode, the vendor can create, edit and change the status of orders. After closing and reopening the app, everything is still there.
3. **Syncs:** after the connection returns, changes reach the server within **30 seconds** while the app is open.
4. **Two devices:** an edit on device A appears on device B (same account) after both sync. If both devices edit the same order, the most recent change wins.
5. **Data is isolated:** a test proves vendor A cannot read or change vendor B's orders.
6. **Correct statuses:** payment status matches the rules above, with automated tests including edge cases (₦0 orders, overpayment).
7. **Runs on low-end phones:** installable from Chrome on Android. It opens in **< 3 seconds** on later visits, on a low-end Android device or Chrome's mid-range phone simulation. The app's JavaScript stays under **200 KB** when compressed.
8. **Money display:** amounts show as ₦ with thousands separators and never show rounding errors.

### Acceptance results (T8)

Automated runs on 2026-10-10. Commands are run in `app/`.

| # | Criterion | Evidence | Status |
|---|---|---|---|
| 1 | Save a new order in ≤ 30 s, first-time tester | Form has 3 required fields; scripted entry is instant. **Needs a human on a real phone.** | ⏳ Real-phone test |
| 2 | Works offline after first sign-in | `test:e2e` (prod): app opens with site down, orders saved offline survive reloads | ✅ (emulated) |
| 3 | Changes reach server ≤ 30 s once online | `test:live`: 410 ms round trip. `test:e2e`: about 4 s after save (3 s deliberate delay) | ✅ |
| 4 | Two devices converge; most recent change wins | `test:live` (real Supabase), sync unit tests | ✅ |
| 5 | Vendors' data isolated | `db:test` (RLS, 14 checks), `test:e2e` (second vendor on same phone) | ✅ |
| 6 | Correct payment statuses incl. edge cases | Unit tests (₦0 orders, overpayment) | ✅ |
| 7 | Installable; later visits open < 3 s; JS < 200 KB | `test:perf` (CPU 4× slower, slow 4G, 300 orders): installable per Chrome, about 0.5 s later visits, 0.6 s offline, 135 KB JS | ✅ (simulated) · ⏳ Real low-end phone |
| 8 | ₦ display, no rounding errors | Unit tests (kobo integers), `test:e2e` (₦18,500.50 stored as 1,850,050 kobo) | ✅ |

**Real-phone checklist** (Chrome on Android, ideally a low-end model):
- [ ] Install to the home screen; it opens full-screen with the green icon
- [ ] Sign in with an email code
- [ ] A first-time person (not us) saves an order: time it (target ≤ 30 s)
- [ ] Airplane mode: open the app from the home screen, add and edit orders, close and reopen
- [ ] Airplane mode off: banner goes to "All changes backed up" and orders are in Supabase
- [ ] Later opens from the home screen feel under 3 s (time 3 opens)
- [ ] Android back button moves through screens and doesn't exit unexpectedly
- [ ] Keyboard: amount field shows numbers, the code field offers autofill from SMS/email
- [ ] Text is readable and buttons are easy to tap; nothing is cut off on a small screen

---

## 5. Task Breakdown

Each task ends with a review before the next one starts.

| # | Task | Output |
|---|---|---|
| T0 | **You:** create the Supabase project and a Cloudflare account | Project URL and public key (shared safely, not committed) |
| T1 | Check local tooling (Node LTS, Git) and propose `git init` | Tool versions confirmed |
| T2 | Set up the project: Vite + React + TS, code-style checks, Vitest test runner, PWA plugin | Empty app that builds and installs |
| T3 | Database: SQL migration for `orders`, security rules, server timestamp, "most recent change wins" check | Migration file plus a security test |
| T4 | Local data layer: Dexie schema, order functions, payment-status calculation | Unit tests passing |
| T5 | Screens: list, new order, detail | Working on the device, offline only |
| T6 | Sign-in: email plus 6-digit code | Sign-in working |
| T7 | Sync engine plus indicator | Sync tests passing (including conflicts) |
| T8 | Test on a real Android phone against §4 | Checklist of results |
| T9 | Deploy to Cloudflare Pages; set up a custom email service for sign-in codes | Pilot-ready link |

---

## 6. Out of Scope for Step 1

Everything in `PROJECT_BRIEF.md` §9 still applies, plus:

- Totals, analytics and dashboard filters (step 2)
- Copyable WhatsApp summaries (step 3)
- Multiple vendors per account, assistants, riders
- Line items, product catalog, inventory
- Search (revisit in step 2)
- Phone or SMS sign-in
- Data export, push notifications
- iOS-specific fixes (it may work on iPhone, but we won't test there in step 1)

## 7. Risks

| Risk | Mitigation |
|---|---|
| Sync bugs lose or duplicate orders | IDs created on the device, soft deletes, automated sync tests before any real vendor data |
| Wrong phone clocks break "most recent change wins" | Low risk with mostly one device per vendor. Revisit if pilots use several devices. |
| Browser clears stored data | Ask the browser to keep data permanently; show a warning when changes are waiting to sync |
| Supabase free tier pauses or email limits | Fine for development; budget for paid tier and custom email service before the pilot (T9) |
| Building before validation | Use the first pilot users as a concierge-style test and measure against brief §8 Phase B |

## 8. Open Questions (decide before T9, not blocking T1–T8)

1. **Account and data deletion:** should vendors be able to delete their account and data themselves? Recommended for Nigerian data-protection law (NDPA 2023).
2. **Customer phone field:** keep it, or drop it to reduce the personal data we hold?
3. **App name and domain** for the pilot link.
