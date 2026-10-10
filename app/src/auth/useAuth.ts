import { createContext, useContext } from 'react'
import type { Account } from './account'

export interface AuthState {
  account: Account | null
  /** Call after a successful code check. */
  signedIn: (account: Account) => void
  /** Signs out on this device only, so it works offline. Orders stay in this vendor's on-device database. */
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const state = useContext(AuthContext)
  if (!state) throw new Error('useAuth must be used inside <AuthProvider>')
  return state
}
