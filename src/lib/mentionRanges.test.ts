import { describe, expect, it } from 'vitest'

import { findMentionRanges } from './mentionRanges'

describe('findMentionRanges', () => {
  it('finds user mentions with their offsets, leaving out a trailing full stop', () => {
    const text = '@ota と @Sato_2. を確認'
    expect(findMentionRanges(text)).toEqual([{ end: 4, start: 0, username: 'ota' }, { end: 14, start: 7, username: 'Sato_2' }])
    expect(text.slice(7, 14)).toBe('@Sato_2')
  })

  it('keeps a name with a hyphen or a dot inside whole', () => {
    expect(findMentionRanges('(@ota-bot, @first.last)').map((range) => range.username)).toEqual(['ota-bot', 'first.last'])
  })

  it('leaves out addresses, group mentions, @all and code', () => {
    const text = 'mail@example.com @group/sub @all `@ota`\n```\n@sato\n```\n@kato'
    expect(findMentionRanges(text)).toEqual([{ end: text.length, start: text.indexOf('@kato'), username: 'kato' }])
  })
})
