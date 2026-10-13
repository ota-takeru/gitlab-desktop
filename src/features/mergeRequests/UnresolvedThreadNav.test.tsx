import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { Discussion, Note } from '../../types/gitlab'
import { UnresolvedThreadNav } from './UnresolvedThreadNav'

function note(id: string, body: string, resolved: boolean, position: Note['position'] = null): Note {
  return { author: { id: 'u1', name: 'Reviewer', username: 'reviewer' }, body, createdAt: '2026-01-01T00:00:00Z', id, position, resolvable: true, resolved, system: false }
}

const position = { baseSha: '', headSha: '', newLine: 12, newPath: 'src/app/main.ts', oldPath: 'src/app/main.ts', positionType: 'text' as const, startSha: '' }
const discussions: Discussion[] = [
  { id: 'open-line', individualNote: false, notes: [note('1', 'この分岐は\n不要では？', false, position)] },
  { id: 'done', individualNote: false, notes: [note('2', '対応済み', true)] },
  { id: 'open-general', individualNote: false, notes: [note('3', '全体の**方針**を `確認` したいです', false)] },
]

describe('UnresolvedThreadNav', () => {
  it('lists only unresolved threads with their place and opens the chosen one', () => {
    const onSelect = vi.fn()
    render(<UnresolvedThreadNav discussions={discussions} olderNotLoaded onSelect={onSelect} />)

    const nav = screen.getByRole('navigation', { name: '未解決のスレッド' })
    expect(within(nav).getByText('2件')).toBeInTheDocument()
    expect(within(nav).getByText('main.ts:12 · Reviewer')).toBeInTheDocument()
    expect(within(nav).getByText('この分岐は 不要では？')).toBeInTheDocument()
    expect(within(nav).queryByText('対応済み')).not.toBeInTheDocument()
    expect(within(nav).getByText('読み込んでいない以前の議論は含みません。')).toBeInTheDocument()

    fireEvent.click(within(nav).getByText('全体の方針を 確認 したいです'))
    expect(onSelect).toHaveBeenCalledWith('open-general')
  })

  it('says when the shown discussions have no unresolved thread', () => {
    render(<UnresolvedThreadNav discussions={[discussions[1]]} olderNotLoaded={false} onSelect={() => undefined} />)
    expect(screen.getByText('表示中の議論に未解決のスレッドはありません。')).toBeInTheDocument()
  })
})
