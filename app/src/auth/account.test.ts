import { describe, expect, it } from 'vitest'
import { authErrorMessage, clearAccount, loadAccount, normaliseCode, normaliseEmail, saveAccount } from './account'

class MemoryStorage implements Storage {
  private data = new Map<string, string>()
  get length() {
    return this.data.size
  }
  clear() {
    this.data.clear()
  }
  getItem(key: string) {
    return this.data.get(key) ?? null
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null
  }
  removeItem(key: string) {
    this.data.delete(key)
  }
  setItem(key: string, value: string) {
    this.data.set(key, value)
  }
}

describe('account storage', () => {
  it('saves, loads and clears the signed-in vendor', () => {
    const storage = new MemoryStorage()
    expect(loadAccount(storage)).toBeNull()

    saveAccount({ id: 'u1', email: 'ada@example.com' }, storage)
    expect(loadAccount(storage)).toEqual({ id: 'u1', email: 'ada@example.com' })

    clearAccount(storage)
    expect(loadAccount(storage)).toBeNull()
  })

  it('treats corrupt or incomplete data as signed out', () => {
    const storage = new MemoryStorage()
    for (const bad of ['not json', '{"id":"u1"}', '{"id":1,"email":"x@y.z"}', '[]', '42']) {
      storage.setItem('account', bad)
      expect(loadAccount(storage)).toBeNull()
    }
  })
})

describe('normaliseEmail', () => {
  it('trims and lower-cases valid emails', () => {
    expect(normaliseEmail('  Ada.Okafor@Example.COM ')).toBe('ada.okafor@example.com')
  })

  it.each(['', 'ada', 'ada@', '@example.com', 'ada@example', 'ada @example.com'])('rejects %j', (input) => {
    expect(normaliseEmail(input)).toBeNull()
  })
})

describe('normaliseCode', () => {
  it('accepts 6–10 digits, ignoring spaces and dashes', () => {
    expect(normaliseCode('123456')).toBe('123456')
    expect(normaliseCode(' 123 456 ')).toBe('123456')
    expect(normaliseCode('123-456')).toBe('123456')
    expect(normaliseCode('1234567890')).toBe('1234567890')
  })

  it.each(['', '12345', '12345678901', 'abcdef', '12345a'])('rejects %j', (input) => {
    expect(normaliseCode(input)).toBeNull()
  })
})

describe('authErrorMessage', () => {
  it('explains being offline first', () => {
    expect(authErrorMessage({ code: 'otp_expired' }, false)).toMatch(/No internet/)
    expect(authErrorMessage({ name: 'AuthRetryableFetchError' }, true)).toMatch(/No internet/)
  })

  it('maps common Supabase error codes', () => {
    expect(authErrorMessage({ code: 'over_email_send_rate_limit', status: 429 }, true)).toMatch(/Too many codes/)
    expect(authErrorMessage({ status: 429 }, true)).toMatch(/Too many codes/)
    expect(authErrorMessage({ code: 'otp_expired', status: 403 }, true)).toMatch(/wrong or has expired/)
    expect(authErrorMessage({ code: 'email_address_invalid' }, true)).toMatch(/doesn’t look right/)
  })

  it('falls back to a generic message', () => {
    expect(authErrorMessage(new Error('boom'), true)).toBe('Something went wrong. Please try again.')
    expect(authErrorMessage(undefined, true)).toBe('Something went wrong. Please try again.')
  })
})
