import '@testing-library/jest-dom/vitest'
import { beforeEach } from 'vitest'

import { MARKDOWN_EDITOR_MODE_KEY } from '../components/MarkdownEditor'
import { setLocalePreference } from '../i18n/i18n'

// Tests find elements by their Japanese text, so they run in Japanese whatever the machine's language.
await setLocalePreference('ja')

beforeEach(() => {
  // Most tests drive the plain Markdown input; rich editor tests opt in.
  globalThis.localStorage?.setItem(MARKDOWN_EDITOR_MODE_KEY, 'source')
})
