const key = (userId: string) => `how-to-seen:${userId}`

/** True once this vendor has dismissed the how-to on this phone. */
export function hasSeenHowTo(userId: string, storage: Storage = localStorage): boolean {
  try {
    return storage.getItem(key(userId)) === '1'
  } catch {
    return false
  }
}

export function markHowToSeen(userId: string, storage: Storage = localStorage): void {
  try {
    storage.setItem(key(userId), '1')
  } catch {
    // The screen can show again next time.
  }
}

/** True when the app is already open from the home screen (installed), so the install step is unnecessary. */
export function isInstalledApp({
  standalone = false,
  fullscreen = false,
  iosStandalone = false,
}: {
  standalone?: boolean
  fullscreen?: boolean
  iosStandalone?: boolean
} = {}): boolean {
  return standalone || fullscreen || iosStandalone
}

export function installedOnThisPhone(): boolean {
  const ios = navigator as Navigator & { standalone?: boolean }
  return isInstalledApp({
    standalone: window.matchMedia('(display-mode: standalone)').matches,
    fullscreen: window.matchMedia('(display-mode: fullscreen)').matches,
    iosStandalone: ios.standalone === true,
  })
}
