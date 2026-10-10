import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { clearAccount, loadAccount, saveAccount, type Account } from './account'
import { auth } from './client'
import { AuthContext } from './useAuth'

/**
 * Who is signed in is decided only by the on-device account record (BUILD_PLAN.md D9),
 * changed only by signing in (SignIn) or out (here).
 *
 * Deliberately not driven by supabase auth events: an offline sign-out finishes
 * clearing the old session seconds later and then emits SIGNED_OUT, which would
 * sign out whoever had signed in since. A missing or mismatched Supabase session
 * is handled by sync instead ("Sign in again to back up"), without locking the
 * vendor out of their orders.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(() => loadAccount())

  const signedIn = useCallback((next: Account) => {
    saveAccount(next)
    setAccount(next)
  }, [])

  const signOut = useCallback(async () => {
    clearAccount()
    setAccount(null)
    try {
      await auth.signOut({ scope: 'local' })
    } catch {
      // Local sign-out only clears stored tokens; nothing to recover from.
    }
  }, [])

  const value = useMemo(() => ({ account, signedIn, signOut }), [account, signedIn, signOut])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
