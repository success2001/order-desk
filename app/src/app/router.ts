import { useSyncExternalStore } from 'react'

// Minimal hash router. Hash URLs work offline with the service worker and
// keep the Android back button working inside the installed app.

export type Route =
  | { name: 'list' }
  | { name: 'new' }
  | { name: 'account' }
  | { name: 'dashboard' }
  | { name: 'detail'; id: string }
  | { name: 'edit'; id: string }

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '') || '/'
  if (path === '/new') return { name: 'new' }
  if (path === '/account') return { name: 'account' }
  if (path === '/dashboard') return { name: 'dashboard' }
  const match = path.match(/^\/orders\/([0-9a-f-]{36})(\/edit)?$/i)
  if (match) return match[2] ? { name: 'edit', id: match[1] } : { name: 'detail', id: match[1] }
  return { name: 'list' }
}

/** Opens a page and adds it to history, so the back button returns here. */
export function navigate(path: string): void {
  history.pushState({ inApp: true }, '', `#${path}`)
  notify()
}

/** Goes back to the previous in-app page, or to the orders list if the app was opened directly on this page. */
export function goBack(): void {
  if ((history.state as { inApp?: boolean } | null)?.inApp) {
    history.back()
  } else {
    history.replaceState(null, '', '#/')
    notify()
  }
}

/** Returns to the orders list without adding history, e.g. after signing out. */
export function resetRoute(): void {
  history.replaceState(null, '', '#/')
  notify()
}

const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  window.addEventListener('popstate', listener)
  window.addEventListener('hashchange', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('popstate', listener)
    window.removeEventListener('hashchange', listener)
  }
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash)
  return parseRoute(hash)
}
