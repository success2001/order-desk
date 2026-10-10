import Dexie from 'dexie'

/**
 * Asks the browser not to clear stored orders when the phone runs low on space
 * (BUILD_PLAN.md §3). Chrome grants this to installed apps automatically.
 */
export async function requestPersistentStorage(): Promise<void> {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist()
    }
  } catch {
    // Not supported: orders are still saved, just without the extra protection.
  }
}

/**
 * Removes the pre-sign-in database from T5 builds. It only ever held test
 * data (that build was never deployed), and orders now live per vendor.
 */
export async function deleteLegacyDeviceDb(): Promise<void> {
  try {
    await Dexie.delete('orders-device')
  } catch {
    // Nothing to remove.
  }
}
