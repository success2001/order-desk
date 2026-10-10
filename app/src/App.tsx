import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { goBack, navigate, useRoute, type Route } from './app/router'
import { auth, SUPABASE_KEY, SUPABASE_URL } from './auth/client'
import { useAuth } from './auth/useAuth'
import { AccountPage } from './components/AccountPage'
import { DashboardPage } from './components/DashboardPage'
import { OrderDetail } from './components/OrderDetail'
import { OrderForm } from './components/OrderForm'
import { OrdersList } from './components/OrdersList'
import { SignIn } from './components/SignIn'
import { SyncIndicator } from './components/SyncIndicator'
import { UpdatePrompt } from './components/UpdatePrompt'
import { DbProvider } from './orders/DbProvider'
import { useDb } from './orders/useDb'
import { getOrder } from './orders/repository'
import { createSupabaseRemote } from './sync/supabaseRemote'
import { SyncProvider } from './sync/SyncProvider'
import { ordersTable, paymentsTable, type RemoteOrderRow, type RemotePaymentRow } from './sync/tables'

const TITLES: Record<Route['name'], string> = {
  list: 'Orders',
  new: 'New order',
  account: 'Account',
  dashboard: 'Dashboard',
  detail: 'Order',
  edit: 'Edit order',
}

function App() {
  const { account } = useAuth()

  return (
    <>
      <UpdatePrompt />
      {account ? (
        // key: a different vendor gets a fresh database and fresh screen state
        <DbProvider key={account.id} userId={account.id}>
          <SyncedOrdersApp vendorId={account.id} />
        </DbProvider>
      ) : (
        <SignIn />
      )}
    </>
  )
}

function SyncedOrdersApp({ vendorId }: { vendorId: string }) {
  // Synced tables, in push/pull order (tables that others reference come first).
  const tables = useMemo(() => {
    const remote = createSupabaseRemote({ auth, vendorId, url: SUPABASE_URL, key: SUPABASE_KEY })
    return [ordersTable(remote<RemoteOrderRow>('orders')), paymentsTable(remote<RemotePaymentRow>('payments'))]
  }, [vendorId])
  return (
    <SyncProvider tables={tables}>
      <OrdersApp />
    </SyncProvider>
  )
}

function OrdersApp() {
  const route = useRoute()

  return (
    <div className="app">
      <header className="topbar">
        {route.name !== 'list' && (
          <button type="button" className="topbar__back" onClick={goBack} aria-label="Back">
            ←
          </button>
        )}
        <h1>{TITLES[route.name]}</h1>
        {route.name === 'list' && (
          <nav className="topbar__actions" aria-label="Main">
            <button type="button" className="topbar__action" onClick={() => navigate('/dashboard')}>
              Dashboard
            </button>
            <button type="button" className="topbar__action" onClick={() => navigate('/account')}>
              Account
            </button>
          </nav>
        )}
      </header>
      <SyncIndicator />

      <main className="content">
        {route.name === 'list' && <OrdersList />}
        {route.name === 'new' && <OrderForm />}
        {route.name === 'account' && <AccountPage />}
        {route.name === 'dashboard' && <DashboardPage />}
        {(route.name === 'detail' || route.name === 'edit') && <OrderPage id={route.id} edit={route.name === 'edit'} />}
      </main>
    </div>
  )
}

function OrderPage({ id, edit }: { id: string; edit: boolean }) {
  const db = useDb()
  // undefined = still loading, null = missing or deleted
  const order = useLiveQuery(async () => (await getOrder(db, id)) ?? null, [db, id])

  if (order === undefined) return null
  if (order === null) {
    return (
      <p className="empty">
        This order doesn’t exist or was deleted.{' '}
        <button type="button" className="link" onClick={goBack}>
          Go back
        </button>
      </p>
    )
  }
  // key: start the form fresh for each order rather than reusing another order's typed values
  return edit ? <OrderForm key={order.id} order={order} /> : <OrderDetail order={order} />
}

export default App
