import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import type { GitLabSession, Position } from '../../types/gitlab'
import { AutoUpdateSafetyProvider, useAutoUpdateAllowed } from '../shared/AutoUpdateSafety'
import { clearComposerBufferStore, createComposerBufferKey, useComposerBuffer } from './useComposerBuffer'

const sessionA: GitLabSession = {
  id: 'session-a',
  instanceUrl: 'https://gitlab.example.com',
  serverVersion: '18.0',
  user: { id: '1', name: 'A', username: 'a' },
}
const sessionB: GitLabSession = {
  ...sessionA,
  id: 'session-b',
  user: { id: '2', name: 'B', username: 'b' },
}
const position: Position = {
  baseSha: 'a'.repeat(40),
  headSha: 'b'.repeat(40),
  newLine: 12,
  newPath: 'new.ts',
  oldLine: 10,
  oldPath: 'old.ts',
  positionType: 'text',
  startSha: 'c'.repeat(40),
}

function Indicator() {
  return <output data-testid="safe">{useAutoUpdateAllowed() ? 'safe' : 'unsafe'}</output>
}

function Composer({ bufferKey, label = 'body' }: { bufferKey: string; label?: string }) {
  const buffer = useComposerBuffer(bufferKey)
  return <><textarea aria-label={label} onChange={(event) => buffer.change(event.target.value)} value={buffer.body} /><button onClick={buffer.discard}>discard</button>{buffer.error ? <output>{buffer.error}</output> : null}</>
}

describe('useComposerBuffer', () => {
  beforeEach(() => {
    clearComposerBufferStore()
  })

  it('retains actual buffered text and updater safety across unmount/remount', () => {
    const key = createComposerBufferKey(sessionA, 'project-1', '7', 'new', position)
    const view = render(<AutoUpdateSafetyProvider><Composer bufferKey={key} /><Indicator /></AutoUpdateSafetyProvider>)
    fireEvent.change(screen.getByRole('textbox', { name: 'body' }), { target: { value: '未送信の本文' } })
    expect(screen.getByTestId('safe')).toHaveTextContent('unsafe')

    view.rerender(<AutoUpdateSafetyProvider><Indicator /></AutoUpdateSafetyProvider>)
    expect(screen.getByTestId('safe')).toHaveTextContent('unsafe')

    view.rerender(<AutoUpdateSafetyProvider><Composer bufferKey={key} /><Indicator /></AutoUpdateSafetyProvider>)
    expect(screen.getByRole('textbox', { name: 'body' })).toHaveValue('未送信の本文')
    fireEvent.click(screen.getByRole('button', { name: 'discard' }))
    expect(screen.getByTestId('safe')).toHaveTextContent('safe')
  })

  it('isolates buffers by account and clearing logout state clears safety', () => {
    const keyA = createComposerBufferKey(sessionA, 'project-1', '7', 'new', position)
    const keyB = createComposerBufferKey(sessionB, 'project-1', '7', 'new', position)
    const view = render(<AutoUpdateSafetyProvider><Composer bufferKey={keyA} /><Indicator /></AutoUpdateSafetyProvider>)
    fireEvent.change(screen.getByRole('textbox', { name: 'body' }), { target: { value: 'Aだけの本文' } })

    view.rerender(<AutoUpdateSafetyProvider><Composer key={keyB} bufferKey={keyB} /><Indicator /></AutoUpdateSafetyProvider>)
    expect(screen.getByRole('textbox', { name: 'body' })).toHaveValue('')
    expect(screen.getByTestId('safe')).toHaveTextContent('unsafe')

    act(() => clearComposerBufferStore())
    expect(screen.getByTestId('safe')).toHaveTextContent('safe')
  })

  it('refuses oversized input without silently truncating retained text', () => {
    const key = createComposerBufferKey(sessionA, 'project-1', '7', 'new', position)
    render(<AutoUpdateSafetyProvider><Composer bufferKey={key} /></AutoUpdateSafetyProvider>)
    fireEvent.change(screen.getByRole('textbox', { name: 'body' }), { target: { value: 'keep' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'body' }), { target: { value: 'あ'.repeat(Math.floor((64 * 1024) / 3) + 1) } })
    expect(screen.getByRole('textbox', { name: 'body' })).toHaveValue('keep')
    expect(screen.getByText(/64 KiB/)).toBeInTheDocument()
  })

  it('refuses a 101st nonempty buffer instead of evicting an existing draft', () => {
    render(<AutoUpdateSafetyProvider>{Array.from({ length: 101 }, (_, index) => <Composer key={index} bufferKey={`buffer-${index}`} label={`body-${index}`} />)}</AutoUpdateSafetyProvider>)
    const textboxes = screen.getAllByRole('textbox')
    for (let index = 0; index < 100; index += 1) {
      fireEvent.change(textboxes[index], { target: { value: `draft-${index}` } })
    }
    fireEvent.change(textboxes[100], { target: { value: 'must-not-evict' } })

    expect(textboxes[100]).toHaveValue('')
    expect(textboxes[0]).toHaveValue('draft-0')
    expect(screen.getByText(/100件まで/)).toBeInTheDocument()
  })
})
