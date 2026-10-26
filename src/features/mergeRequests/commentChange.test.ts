import { describe, expect, it } from 'vitest'
import { compareCommentCode } from './commentChange'

describe('compareCommentCode', () => {
  it('keeps unchanged code when earlier lines are inserted', () => {
    expect(compareCommentCode('header\ntarget\nfooter', 'new\nheader\ntarget\nfooter', { newLine: 2 }).state).toBe('unchanged')
  })
  it('detects removed or edited text from the current file', () => {
    expect(compareCommentCode('header\ntarget\nfooter', 'header\nchanged\nfooter', { newLine: 2 }).state).toBe('changed')
  })
  it('does not claim unchanged for duplicate text or deleted-line positions', () => {
    expect(compareCommentCode('target\ntarget', 'target\ntarget', { newLine: 1 }).state).toBe('unknown')
    expect(compareCommentCode('target', 'target', {}).state).toBe('unknown')
  })
  it('compares entire multi-line comment ranges', () => {
    const state = compareCommentCode('a\nb\nc', 'x\na\nb\nc', { newLine: 3, lineRange: { start: { newLine: 2, type: 'new' }, end: { newLine: 3, type: 'new' } } })
    expect(state.state).toBe('unchanged')
  })
})
