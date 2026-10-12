import { describe, expect, it } from 'vitest'
import { hasSeenHowTo, isInstalledApp, markHowToSeen } from './howTo'

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

describe('how-to seen flag', () => {
  it('remembers one vendor without hiding the screen for another', () => {
    const storage = new MemoryStorage()
    expect(hasSeenHowTo('ada', storage)).toBe(false)

    markHowToSeen('ada', storage)
    expect(hasSeenHowTo('ada', storage)).toBe(true)
    expect(hasSeenHowTo('bayo', storage)).toBe(false)
  })

  it('treats a storage failure as not yet seen', () => {
    const storage = {
      getItem() {
        throw new Error('blocked')
      },
      setItem() {
        throw new Error('blocked')
      },
    } as unknown as Storage
    expect(hasSeenHowTo('ada', storage)).toBe(false)
    expect(() => markHowToSeen('ada', storage)).not.toThrow()
  })
})

describe('isInstalledApp', () => {
  it('is installed when opened from the home screen', () => {
    expect(isInstalledApp()).toBe(false)
    expect(isInstalledApp({ standalone: true })).toBe(true)
    expect(isInstalledApp({ fullscreen: true })).toBe(true)
    expect(isInstalledApp({ iosStandalone: true })).toBe(true)
  })
})
