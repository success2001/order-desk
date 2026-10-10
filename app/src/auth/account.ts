// The signed-in vendor, remembered on the device.
//
// Why not just use the Supabase session? When the phone is offline and the
// 1-hour access token has expired, supabase-js reports "no session" because it
// cannot refresh (auth-js GoTrueClient __loadSession). Vendors must still be
// able to open their orders offline, so the app decides "signed in" from this
// record. The Supabase session is only needed to sync (T7).

export interface Account {
  id: string
  email: string
}

const KEY = 'account'

export function loadAccount(storage: Storage = localStorage): Account | null {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(KEY) ?? 'null')
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as Account).id === 'string' &&
      typeof (parsed as Account).email === 'string'
    ) {
      return { id: (parsed as Account).id, email: (parsed as Account).email }
    }
  } catch {
    // Corrupt or unavailable storage: treat as signed out.
  }
  return null
}

export function saveAccount(account: Account, storage: Storage = localStorage): void {
  storage.setItem(KEY, JSON.stringify({ id: account.id, email: account.email }))
}

export function clearAccount(storage: Storage = localStorage): void {
  try {
    storage.removeItem(KEY)
  } catch {
    // Nothing to clear.
  }
}

/** Trimmed, lower-cased email, or null if it doesn't look like an email address. */
export function normaliseEmail(input: string): string | null {
  const email = input.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : null
}

/** The sign-in code with spaces and dashes removed, or null if it isn't 6–10 digits. */
export function normaliseCode(input: string): string | null {
  const code = input.replace(/[\s-]/g, '')
  return /^\d{6,10}$/.test(code) ? code : null
}

/** A message a vendor can act on, from a Supabase auth error. */
export function authErrorMessage(error: unknown, online: boolean): string {
  const { code, status, name } = (error ?? {}) as { code?: string; status?: number; name?: string }

  if (!online || name === 'AuthRetryableFetchError') {
    return 'No internet connection. Connect to sign in. After that, the app works offline.'
  }
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || status === 429) {
    return 'Too many codes requested. Please wait a few minutes and try again.'
  }
  if (code === 'otp_expired' || code === 'otp_disabled') {
    return 'That code is wrong or has expired. Check your latest email, or send a new code.'
  }
  if (code === 'email_address_invalid' || code === 'validation_failed') {
    return 'That email address doesn’t look right. Please check it.'
  }
  if (code === 'signup_disabled' || code === 'user_not_found') {
    return 'This email isn’t registered for the pilot yet.'
  }
  return 'Something went wrong. Please try again.'
}
