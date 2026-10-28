/** Languages with a message file in ./messages. English is the source and the fallback for missing messages. */
export const supportedLocales = ['en', 'ja', 'zh-Hans', 'zh-Hant', 'ko', 'de', 'fr', 'es', 'pt-BR', 'ru'] as const
export type Locale = (typeof supportedLocales)[number]
/** 'system' follows the OS display language, also when it changes while the app is open. */
export type LocalePreference = Locale | 'system'

export const sourceLocale: Locale = 'en'

/** Each language is listed in its own name, so it can be found whatever language is shown. */
export const localeNames: Record<Locale, string> = {
  en: 'English',
  ja: '日本語',
  'zh-Hans': '简体中文',
  'zh-Hant': '繁體中文',
  ko: '한국어',
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
  'pt-BR': 'Português (Brasil)',
  ru: 'Русский',
}

const localeKey = 'gitlab-desktop:locale'

function isLocale(value: string): value is Locale {
  return (supportedLocales as readonly string[]).includes(value)
}

function supportedTag(tag: string): Locale | undefined {
  return supportedLocales.find((locale) => locale.toLowerCase() === tag.toLowerCase())
}

/**
 * The first supported language in the user's order: the exact tag, else the same language in
 * the same script (zh-TW → zh-Hant) or region, else any variant of the language (pt-PT → pt-BR),
 * else English.
 */
export function matchLocale(tags: readonly string[]): Locale {
  for (const tag of tags) {
    let locale: Intl.Locale
    try {
      locale = new Intl.Locale(tag).maximize()
    } catch {
      continue
    }
    const { language, script, region } = locale
    const match = supportedTag(tag) ?? supportedTag(`${language}-${script}`) ?? supportedTag(`${language}-${region}`) ?? supportedTag(language)
      ?? supportedLocales.find((supported) => supported.split('-')[0] === language)
    if (match) return match
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
