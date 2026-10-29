import { fireEvent, render, screen } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { describe, expect, it, vi } from 'vitest'

import { createAppTheme } from '../../theme'
import type { Discussion, GitLabUser } from '../../types/gitlab'
import type { ParsedLine } from './diffParser'
import { LineThreads, type ThreadView } from './DiffThreads'

const author: GitLabUser = { id: '2', name: '他の人', username: 'colleague' }
const line: ParsedLine = { commentable: true, kind: 'add', newLine: 3, newPath: 'a.ts', oldPath: 'a.ts', prefix: '+', text: 'x' }
const thread = (resolved: boolean): Discussion => ({ id: 'd1', individualNote: false, notes: [{ author, body: 'スレッドの本文', createdAt: '2026-01-01T00:00:00.000Z', id: 'n1', position: null, resolvable: true, resolved, system: false }] })
const view = (resolved: boolean, onResolve = vi.fn()): ThreadView => ({ actions: { disabled: false, onReply: vi.fn(), onResolve, replyComposer: null, replyDiscussionId: null }, threads: new Map([['n:3', [thread(resolved)]]]) })
const threads = (value: ThreadView) => <ThemeProvider theme={createAppTheme('light')}><LineThreads line={line} view={value} /></ThemeProvider>

describe('line threads in the diff', () => {
  it('starts a resolved thread folded but keeps an open one open when someone else resolves it', () => {
    const folded = render(threads(view(true)))
    expect(screen.queryByText('スレッドの本文')).not.toBeInTheDocument()
    folded.unmount()

    const open = render(threads(view(false)))
    expect(screen.getByText('スレッドの本文')).toBeInTheDocument()
    open.rerender(threads(view(true)))
    expect(screen.getByText('スレッドの本文')).toBeInTheDocument()
  })

  it('folds a thread resolved here once GitLab reports it resolved', () => {
    const onResolve = vi.fn()
    const open = render(threads(view(false, onResolve)))
    fireEvent.click(screen.getByRole('button', { name: /解決/u }))
    expect(onResolve).toHaveBeenCalledWith(expect.objectContaining({ id: 'd1' }), true)
    open.rerender(threads(view(true, onResolve)))
    expect(screen.queryByText('スレッドの本文')).not.toBeInTheDocument()
  })
})
