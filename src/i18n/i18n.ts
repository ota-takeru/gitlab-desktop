import { IntlMessageFormat } from 'intl-messageformat'

import en from './messages/en.json'
import { readLocalePreference, resolveLocale, saveLocalePreference, sourceLocale, type Locale, type LocalePreference } from './locales'

/** Message keys are the keys of the English source file. */
export type MessageKey = keyof typeof en
export type MessageValues = Record<string, string | number>
type Messages = Partial<Record<MessageKey, string>>

// English is bundled as the fallback; other languages load when chosen, so adding one does not grow the start-up bundle.
const loaders = import.meta.glob<Messages>(['./messages/*.json', '!./messages/en.json'], { import: 'default' })

interface State { preference: LocalePreference; locale: Locale; messages: Messages }

let state: State = { preference: 'system', locale: sourceLocale, messages: en }
let formatters = new Map<MessageKey, IntlMessageFormat>()
let latestRequest = 0
const listeners = new Set<() => void>()

async function loadMessages(locale: Locale): Promise<Messages> {
  if (locale === sourceLocale) return en
  const load = loaders[`./messages/${locale}.json`]
  return load ? load() : {}
}

async function apply(preference: LocalePreference): Promise<void> {
  const request = ++latestRequest
  const locale = resolveLocale(preference)
  const messages = await loadMessages(locale)
  // A later choice made while this file was loading wins.
  if (request !== latestRequest) return
  state = { preference, locale, messages }
  formatters = new Map()
  if (globalThis.document) document.documentElement.lang = locale
  for (const listener of listeners) listener()
}

/** Loads the saved language before the first render, so the app does not open in English and then switch. */
export async function initializeLocale(): Promise<void> {
  globalThis.addEventListener?.('languagechange', () => {
    if (state.preference === 'system') void apply('system')
  })
  await apply(readLocalePreference())
}

export async function setLocalePreference(preference: LocalePreference): Promise<void> {
  saveLocalePreference(preference)
  await apply(preference)
}

export function currentLocale(): Locale {
  return state.locale
}

export function currentLocalePreference(): LocalePreference {
  return state.preference
}

export function subscribeToLocale(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The message in the current language, or the English one when it is not translated yet. */
export function translate(key: MessageKey, values?: MessageValues): string {
  let formatter = formatters.get(key)
  if (!formatter) {
    const translated = state.messages[key]
    formatter = translated === undefined ? new IntlMessageFormat(en[key], sourceLocale) : new IntlMessageFormat(translated, state.locale)
    formatters.set(key, formatter)
  }
  return formatter.format(values) as string
}
