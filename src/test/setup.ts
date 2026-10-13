import '@testing-library/jest-dom/vitest'
import { beforeEach } from 'vitest'

import { MARKDOWN_EDITOR_MODE_KEY } from '../components/MarkdownEditor'

beforeEach(() => {
  // Most tests drive the plain Markdown input; rich editor tests opt in.
  globalThis.localStorage?.setItem(MARKDOWN_EDITOR_MODE_KEY, 'source')
})
