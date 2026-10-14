import { useSyncExternalStore } from 'react'

export type ColorMode = 'light' | 'dark'
/** 'system' follows the OS appearance, also when it changes while the app is open. */
export type ColorPreference = ColorMode | 'system'

const colorModeKey = 'gitlab-desktop:color-mode'
const lightQuery = '(prefers-color-scheme: light)'

export function readColorPreference(): ColorPreference {
  try {
    const saved = globalThis.localStorage?.getItem(colorModeKey)
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved
  } catch {
    // A locked down WebView follows the OS appearance.
  }
  return 'system'
}

export function saveColorPreference(preference: ColorPreference): void {
  try {
    globalThis.localStorage?.setItem(colorModeKey, preference)
  } catch {
    // The choice still applies for this session.
  }
}

/** Without a media query API the app stays dark, as before. */
export function systemColorMode(): ColorMode {
  return globalThis.matchMedia?.(lightQuery).matches ? 'light' : 'dark'
}

export function resolveColorMode(preference: ColorPreference): ColorMode {
  return preference === 'system' ? systemColorMode() : preference
}

function subscribeToSystemColorMode(onChange: () => void): () => void {
  const query = globalThis.matchMedia?.(lightQuery)
  if (!query) return () => undefined
  query.addEventListener?.('change', onChange)
  return () => query.removeEventListener?.('change', onChange)
}

/** The OS appearance, updated live when the user switches it. */
export function useSystemColorMode(): ColorMode {
  return useSyncExternalStore(subscribeToSystemColorMode, systemColorMode, systemColorMode)
}
