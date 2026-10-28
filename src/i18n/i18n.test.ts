import { IntlMessageFormat } from 'intl-messageformat'
import { afterEach, describe, expect, it } from 'vitest'

import { formatRelativeTime } from '../lib/format'
import { currentLocale, setLocalePreference, translate } from './i18n'
import { matchLocale, readLocalePreference, supportedLocales } from './locales'

// Every language's files, keyed by language, then by feature file.
const messageFiles: Record<string, Record<string, Record<string, string>>> = {}
for (const [path, messages] of Object.entries(import.meta.glob<Record<string, string>>('./messages/*/*.json', { eager: true, import: 'default' }))) {
  const [, locale, file] = /^\.\/messages\/([^/]+)\/([^/]+)\.json$/u.exec(path) ?? []
  messageFiles[locale] = { ...messageFiles[locale], [file]: messages }
}
const en = messageFiles.en

/** Argument names used by a message, including those inside plural and select branches. */
function argumentNames(message: string, locale: string): string[] {
  const names = new Set<string>()
  const visit = (elements: unknown[]) => {
    for (const element of elements as { type: number; value?: unknown; options?: Record<string, { value: unknown[] }> }[]) {
      // Literals (0) and # (7) carry no argument name.
      if (element.type !== 0 && element.type !== 7 && typeof element.value === 'string') names.add(element.value)
      for (const option of Object.values(element.options ?? {})) visit(option.value)
    }
  }
  visit(new IntlMessageFormat(message, locale).getAst())
  return [...names].sort()
}

afterEach(async () => {
  await setLocalePreference('ja')
})

describe('message files', () => {
  it('has a folder per supported language', () => {
    expect(Object.keys(messageFiles).sort()).toEqual([...supportedLocales].sort())
  })

  it.each(supportedLocales)('%s parses and uses the same arguments as English', (locale) => {
    for (const [file, messages] of Object.entries(messageFiles[locale])) {
      expect(Object.keys(en), `${locale}: unknown file ${file}`).toContain(file)
      for (const key of Object.keys(messages)) {
        expect(Object.keys(en[file]), `${locale}: unknown key ${file}.${key}`).toContain(key)
        expect(messages[key].trim(), `${locale}: empty ${file}.${key}`).not.toBe('')
        expect(argumentNames(messages[key], locale), `${locale}: ${file}.${key}`).toEqual(argumentNames(en[file][key], 'en'))
      }
    }
  })

  it.each(supportedLocales)('%s translates every message', (locale) => {
    for (const file of Object.keys(en)) {
      expect(Object.keys(messageFiles[locale]?.[file] ?? {}).sort(), `${locale}: ${file}`).toEqual(Object.keys(en[file]).sort())
    }
  })
})

describe('matchLocale', () => {
  it('takes the first supported language, by exact tag or base language', () => {
    expect(matchLocale(['ja-JP', 'en-US'])).toBe('ja')
    expect(matchLocale(['nl-NL', 'en-GB', 'ja'])).toBe('en')
    expect(matchLocale(['EN'])).toBe('en')
  })

  it('matches Chinese by script and other languages by any variant', () => {
    expect(matchLocale(['zh-TW'])).toBe('zh-Hant')
    expect(matchLocale(['zh-HK'])).toBe('zh-Hant')
    expect(matchLocale(['zh-CN'])).toBe('zh-Hans')
    expect(matchLocale(['zh'])).toBe('zh-Hans')
    expect(matchLocale(['pt-PT'])).toBe('pt-BR')
    expect(matchLocale(['de-AT'])).toBe('de')
  })

  it('falls back to English when nothing matches', () => {
    expect(matchLocale(['nl', 'sv-SE'])).toBe('en')
    expect(matchLocale(['not a tag'])).toBe('en')
    expect(matchLocale([])).toBe('en')
  })
})

describe('switching languages', () => {
  it('formats plurals and dates in the chosen language and marks the document', async () => {
    const now = Date.parse('2026-10-09T12:00:00.000Z')
    await setLocalePreference('en')
    expect(document.documentElement.lang).toBe('en')
    expect(translate('time.minutesAgo', { count: 1 })).toBe('1 minute ago')
    expect(formatRelativeTime('2026-10-09T11:45:00.000Z', now)).toBe('15 minutes ago')
    expect(formatRelativeTime('2025-09-01T12:00:00.000Z', now)).toBe('9/1/2025')

    await setLocalePreference('ja')
    expect(document.documentElement.lang).toBe('ja')
    expect(formatRelativeTime('2026-10-09T11:45:00.000Z', now)).toBe('15分前')
  })

  it('saves the choice and keeps the last one when changes overlap', async () => {
    // Whichever file loads first, the later choice wins.
    await Promise.all([setLocalePreference('ja'), setLocalePreference('en')])
    expect(currentLocale()).toBe('en')
    expect(readLocalePreference()).toBe('en')
  })
})
