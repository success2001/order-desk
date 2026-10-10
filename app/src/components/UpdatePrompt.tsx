import { useRegisterSW } from 'virtual:pwa-register/react'

/**
 * Offers new app versions instead of reloading automatically, so an update
 * never interrupts a vendor in the middle of entering an order.
 */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  if (!needRefresh) return null

  return (
    <div className="update" role="alert">
      <span>A new version is ready.</span>
      <button type="button" className="button button--small" onClick={() => updateServiceWorker(true)}>
        Update
      </button>
      <button type="button" className="button button--small button--ghost" onClick={() => setNeedRefresh(false)}>
        Later
      </button>
    </div>
  )
}
