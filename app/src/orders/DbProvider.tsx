import { useEffect, useMemo, type ReactNode } from 'react'
import { openOrderDb, releaseOrderDb, vendorDbName } from './db'
import { DbContext } from './useDb'

/** One on-device database per vendor, so accounts stay apart on a shared phone. */
export function DbProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const db = useMemo(() => openOrderDb(vendorDbName(userId)), [userId])
  useEffect(() => () => releaseOrderDb(db), [db])
  return <DbContext.Provider value={db}>{children}</DbContext.Provider>
}
