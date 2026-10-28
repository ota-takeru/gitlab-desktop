import { useSyncExternalStore } from 'react'

import { currentLocale, currentLocalePreference, subscribeToLocale, translate } from './i18n'
import type { Locale, LocalePreference } from './locales'

export function useLocale(): Locale {
  return useSyncExternalStore(subscribeToLocale, currentLocale, currentLocale)
}

export function useLocalePreference(): LocalePreference {
  return useSyncExternalStore(subscribeToLocale, currentLocalePreference, currentLocalePreference)
}

/** The translate function; the component re-renders when the language changes. */
export function useT(): typeof translate {
  useLocale()
  return translate
}
