/** Languages with a message file in ./messages. English is the source and the fallback for missing messages. */
export const supportedLocales = ['en', 'ja'] as const
export type Locale = (typeof supportedLocales)[number]
/** 'system' follows the OS display language, also when it changes while the app is open. */
export type LocalePreference = Locale | 'system'

export const sourceLocale: Locale = 'en'

/** Each language is listed in its own name, so it can be found whatever language is shown. */
export const localeNames: Record<Locale, string> = { en: 'English', ja: '日本語' }

const localeKey = 'gitlab-desktop:locale'

function isLocale(value: string): value is Locale {
  return (supportedLocales as readonly string[]).includes(value)
}

/** The first supported language in the user's order: an exact tag, else its base language (pt-BR → pt), else English. */
export function matchLocale(tags: readonly string[]): Locale {
  for (const tag of tags) {
    const lower = tag.toLowerCase()
    if (isLocale(lower)) return lower
    const base = lower.split('-')[0]
    if (isLocale(base)) return base
  }
  return sourceLocale
}

export function systemLocale(): Locale {
  const languages = globalThis.navigator?.languages
  return matchLocale(languages?.length ? languages : [globalThis.navigator?.language ?? sourceLocale])
}

export function resolveLocale(preference: LocalePreference): Locale {
  return preference === 'system' ? systemLocale() : preference
}

export function readLocalePreference(): LocalePreference {
  try {
    const saved = globalThis.localStorage?.getItem(localeKey)
    if (saved === 'system' || (saved && isLocale(saved))) return saved
  } catch {
    // A locked down WebView follows the OS language.
  }
  return 'system'
}

export function saveLocalePreference(preference: LocalePreference): void {
  try {
    globalThis.localStorage?.setItem(localeKey, preference)
  } catch {
    // The choice still applies for this session.
  }
}
