import Dexie from 'dexie'
import { LEGACY_DB_PREFIX } from './db'

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

/** Old database names from before "orderdesk-" (all test data). */
export function isLegacyDbName(name: string): boolean {
  return name.startsWith(LEGACY_DB_PREFIX)
}

/**
 * Deletes every pre-"orderdesk-" database on this device ("orders-device",
 * "orders-<user id>"). They only ever held test data; any unsent changes in
 * them are discarded on purpose so they can never be uploaded.
 *
 * Where the browser cannot list its databases, deletes the known names instead:
 * "orders-device" and those of the given user ids.
 */
export async function deleteLegacyDatabases(knownUserIds: readonly string[] = []): Promise<string[]> {
  let names: string[]
  try {
    names = (await indexedDB.databases()).map((db) => db.name ?? '').filter(isLegacyDbName)
  } catch {
    names = [`${LEGACY_DB_PREFIX}device`, ...knownUserIds.map((id) => `${LEGACY_DB_PREFIX}${id}`)]
  }

  const deleted: string[] = []
  for (const name of names) {
    try {
      await Dexie.delete(name)
      deleted.push(name)
    } catch {
      // Leave it; the app never opens these names, so it can't sync from them.
    }
  }
  return deleted
}
