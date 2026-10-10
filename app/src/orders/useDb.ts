import { createContext, useContext } from 'react'
import type { OrderDb } from './db'

export const DbContext = createContext<OrderDb | null>(null)

export function useDb(): OrderDb {
  const db = useContext(DbContext)
  if (!db) throw new Error('useDb must be used inside <DbProvider>')
  return db
}
