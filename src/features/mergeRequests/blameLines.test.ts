import { describe, expect, it } from 'vitest'
import { blameAttributions, blameWindowStart } from './blameLines'

describe('Blame line mapping', () => {
  it('aligns request ranges at no more than 80 lines', () => {
    expect(blameWindowStart(1)).toBe(1)
    expect(blameWindowStart(80)).toBe(1)
    expect(blameWindowStart(81)).toBe(81)
    expect(blameWindowStart(240)).toBe(161)
  })
  it('maps GitLab blame groups to repository line numbers rather than diff indices', () => {
    const mapped = blameAttributions([
      { authorName: 'A', commitId: 'a', committedAt: '', title: '', lines: ['a', 'b'] },
      { authorName: 'B', commitId: 'b', committedAt: '', title: '', lines: ['c', 'd'] },
    ], 161)
    expect(mapped.get(161)).toMatchObject({ first: true, block: { commitId: 'a' } })
    expect(mapped.get(162)).toMatchObject({ first: false, block: { commitId: 'a' } })
    expect(mapped.get(163)).toMatchObject({ first: true, block: { commitId: 'b' } })
    expect(mapped.get(165)).toBeUndefined()
  })
})
