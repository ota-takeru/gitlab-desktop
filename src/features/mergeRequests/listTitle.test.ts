import { expect, it } from 'vitest'

import { listTitle } from './listTitle'

it('drops the draft prefix only from draft merge requests', () => {
  expect(listTitle({ draft: true, title: 'Draft: 工程検索の速度改善' })).toBe('工程検索の速度改善')
  expect(listTitle({ draft: true, title: '[Draft] Fix login' })).toBe('Fix login')
  expect(listTitle({ draft: true, title: '(draft) Fix login' })).toBe('Fix login')
  expect(listTitle({ draft: false, title: 'Draft: kept as written' })).toBe('Draft: kept as written')
  expect(listTitle({ draft: true, title: 'Draft:' })).toBe('Draft:')
})
