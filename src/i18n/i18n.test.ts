import { IntlMessageFormat } from 'intl-messageformat'
import { afterEach, describe, expect, it } from 'vitest'

import { formatRelativeTime } from '../lib/format'
import { currentLocale, setLocalePreference, translate } from './i18n'
import { matchLocale, readLocalePreference, supportedLocales } from './locales'
import en from './messages/en.json'

const messageFiles = import.meta.glob<Record<string, string>>('./messages/*.json', { eager: true, import: 'default' })

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
  it('has one file per supported language', () => {
    expect(Object.keys(messageFiles).map((path) => path.replace(/^\.\/messages\/|\.json$/gu, '')).sort()).toEqual([...supportedLocales].sort())
  })

  it.each(supportedLocales)('%s parses and uses the same arguments as English', (locale) => {
    const messages = messageFiles[`./messages/${locale}.json`]
    for (const key of Object.keys(messages)) {
      expect(Object.keys(en), `${locale}: unknown key ${key}`).toContain(key)
      expect(messages[key].trim(), `${locale}: empty ${key}`).not.toBe('')
      expect(argumentNames(messages[key], locale), `${locale}: ${key}`).toEqual(argumentNames(en[key as keyof typeof en], 'en'))
    }
  })

  it('translates every message into Japanese', () => {
    expect(Object.keys(messageFiles['./messages/ja.json']).sort()).toEqual(Object.keys(en).sort())
  })
})

describe('matchLocale', () => {
  it('takes the first supported language, by exact tag or base language', () => {
    expect(matchLocale(['ja-JP', 'en-US'])).toBe('ja')
    expect(matchLocale(['fr-FR', 'en-GB', 'ja'])).toBe('en')
    expect(matchLocale(['EN'])).toBe('en')
  })

  it('falls back to English when nothing matches', () => {
    expect(matchLocale(['fr', 'de-DE'])).toBe('en')
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
    // Japanese loads its file; English is bundled and settles first.
    await Promise.all([setLocalePreference('ja'), setLocalePreference('en')])
    expect(currentLocale()).toBe('en')
    expect(readLocalePreference()).toBe('en')
  })
})
