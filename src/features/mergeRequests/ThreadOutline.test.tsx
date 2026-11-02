import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Discussion, Note } from '../../types/gitlab'
import { DiscussionLayout } from './DiscussionLayout'
import { ThreadOutline } from './ThreadOutline'

function note(id: string, body: string, overrides: Partial<Note> = {}): Note {
  return { author: { id: 'u1', name: 'Reviewer', username: 'reviewer' }, body, createdAt: '2026-01-01T00:00:00Z', id, position: null, resolvable: true, resolved: false, system: false, ...overrides }
}

const position = (newPath: string, newLine: number) => ({ baseSha: '', headSha: '', newLine, newPath, oldPath: newPath, positionType: 'text' as const, startSha: '' })
const discussions: Discussion[] = [
  { id: 'main-12', individualNote: false, notes: [note('1', 'この分岐は\n不要では？', { position: position('src/app/main.ts', 12) }), note('1r', '確認します'), note('1s', 'changed the description', { system: true })] },
  { id: 'done', individualNote: false, notes: [note('2', '対応済み', { resolved: true })] },
  { id: 'general', individualNote: false, notes: [note('3', '全体の**方針**を `確認` したいです')] },
  { id: 'main-40', individualNote: false, notes: [note('4', '名前を変えたい', { position: position('src/app/main.ts', 40) })] },
  { id: 'plain', individualNote: true, notes: [note('5', 'ありがとうございます', { resolvable: false })] },
  { id: 'history', individualNote: true, notes: [note('6', 'added 1 commit', { system: true })] },
]

describe('ThreadOutline', () => {
  it('groups the shown threads by file with their state, replies and unread comments, and opens the chosen one', () => {
    const onSelect = vi.fn()
    render(<ThreadOutline discussions={discussions} filter="all" olderNotLoaded onSelect={onSelect} unreadNoteIds={['1r', '3']} />)

    const nav = screen.getByRole('navigation', { name: 'スレッド' })
    expect(within(nav).getByText('未解決 3 / 5')).toBeInTheDocument()
    // Files in the order they first appear; the two comments on main.ts sit together under it.
    expect(within(nav).getAllByRole('group').map((group) => group.getAttribute('aria-label'))).toEqual(['src/app/main.ts', 'MR全体'])
    const main = within(nav).getByRole('group', { name: 'src/app/main.ts' })
    expect(within(main).getAllByRole('button').map((row) => row.getAttribute('data-outline-id'))).toEqual(['main-12', 'main-40'])
    expect(within(main).getByText('この分岐は 不要では？')).toBeInTheDocument()
    expect(within(main).getByText('L12 · Reviewer · 返信 1')).toBeInTheDocument()
    expect(within(main).getByRole('img', { name: '未読 1件' })).toBeInTheDocument()
    const overview = within(nav).getByRole('group', { name: 'MR全体' })
    expect(within(overview).getAllByRole('img', { name: '未解決' })).toHaveLength(1)
    expect(within(overview).getByRole('img', { name: '解決済み' })).toBeInTheDocument()
    expect(within(overview).getByRole('img', { name: 'コメント' })).toBeInTheDocument()
    expect(within(nav).getByText('読み込んでいない以前の議論は含みません。')).toBeInTheDocument()

    fireEvent.click(within(nav).getByText('全体の方針を 確認 したいです'))
    expect(onSelect).toHaveBeenCalledWith('general')
  })

  it('shows only unresolved threads while the list does, and says when there are none', () => {
    const { rerender } = render(<ThreadOutline discussions={discussions} filter="unresolved" olderNotLoaded={false} onSelect={() => undefined} unreadNoteIds={[]} />)
    expect(screen.getAllByRole('button').map((row) => row.getAttribute('data-outline-id'))).toEqual(['main-12', 'main-40', 'general'])

    rerender(<ThreadOutline discussions={[discussions[1]]} filter="unresolved" olderNotLoaded={false} onSelect={() => undefined} unreadNoteIds={[]} />)
    expect(screen.getByText('表示中の議論に未解決のスレッドはありません。')).toBeInTheDocument()
  })
})

describe('ThreadOutline thread in view', () => {
  const original = globalThis.IntersectionObserver
  afterEach(() => { globalThis.IntersectionObserver = original })

  it('marks the first thread in view', () => {
    let report: IntersectionObserverCallback = () => undefined
    const observed: Element[] = []
    globalThis.IntersectionObserver = class {
      constructor(callback: IntersectionObserverCallback) { report = callback }
      observe(element: Element) { observed.push(element) }
      disconnect() { /* nothing to release */ }
    } as unknown as typeof IntersectionObserver
    const shown = discussions.slice(0, 4)
    // Narrow panes (as jsdom's) hide the outline; it follows the list all the same.
    render(<DiscussionLayout
      composer={null}
      navigator={<ThreadOutline discussions={shown} filter="all" olderNotLoaded={false} onSelect={() => undefined} unreadNoteIds={[]} />}
      side={null}
      threads={shown.map((discussion) => <article data-discussion-id={discussion.id} key={discussion.id} />)}
    />)

    expect(observed.map((element) => element.getAttribute('data-discussion-id'))).toEqual(['main-12', 'done', 'general', 'main-40'])
    act(() => report([{ isIntersecting: true, target: observed[2] }, { isIntersecting: true, target: observed[3] }] as unknown as IntersectionObserverEntry[], {} as IntersectionObserver))
    expect(screen.getByRole('button', { current: 'location', hidden: true })).toHaveAttribute('data-outline-id', 'general')
    act(() => report([{ isIntersecting: false, target: observed[2] }] as unknown as IntersectionObserverEntry[], {} as IntersectionObserver))
    expect(screen.getByRole('button', { current: 'location', hidden: true })).toHaveAttribute('data-outline-id', 'main-40')
  })
})
