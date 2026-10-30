import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ReviewComposer } from './ReviewComposer'
import { TemplateMenu } from './TemplateMenu'

const fixtures = vi.hoisted(() => ({
  queries: [] as unknown[],
  templates: [
    { content: 'LGTM', id: 'gid://gitlab/Users::SavedReply/1', name: '承認', scope: 'user' },
    { content: 'テストを追加してください。', id: 'gid://gitlab/Projects::SavedReply/1', name: 'テスト依頼', scope: 'project' },
  ],
}))

vi.mock('../connections/connectionContext', async (importOriginal) => ({ ...await importOriginal<object>(), useConnection: () => ({ session: { id: 'session-1' } }) }))
vi.mock('../shared/useGitLabQuery', () => ({
  useGitLabQuery: (_sessionId: string | null, query: unknown) => {
    fixtures.queries.push(query)
    return { data: query ? fixtures.templates : null, error: null, loading: false, snapshot: null }
  },
}))

describe('TemplateMenu', () => {
  it('reads templates only once opened and groups comment templates by owner', async () => {
    fixtures.queries = []
    const onInsert = vi.fn()
    render(<TemplateMenu onInsert={onInsert} query={{ kind: 'commentTemplates', projectPath: 'group/app' }} />)
    expect(fixtures.queries.every((query) => query === null)).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'テンプレート' }))
    const menu = screen.getByRole('menu')
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['テスト依頼テストを追加してください。', '承認LGTM'])
    expect(within(menu).getByText('プロジェクト')).toBeInTheDocument()
    expect(within(menu).getByText('個人')).toBeInTheDocument()

    fireEvent.click(within(menu).getByText('承認'))
    await waitFor(() => expect(onInsert).toHaveBeenCalledWith('LGTM'))
  })

  it('inserts the chosen comment template at the caret of the composer and leaves the focus there', async () => {
    function Harness() {
      const [value, setValue] = useState('前置き')
      return <ReviewComposer onCancelReply={() => undefined} onChange={setValue} onClearPosition={() => undefined} onSaveDraft={async () => true} onSubmitComment={async () => true} templateProjectPath="group/app" value={value} />
    }
    render(<Harness />)
    const textbox = screen.getByRole('textbox', { name: 'コメント本文' }) as HTMLTextAreaElement
    textbox.setSelectionRange(3, 3)

    fireEvent.click(screen.getByRole('button', { name: 'テンプレート' }))
    fireEvent.click(within(screen.getByRole('menu')).getByText('テスト依頼'))
    await waitFor(() => expect(textbox.value).toBe('前置き\nテストを追加してください。'))
    expect(textbox).toHaveFocus()
  })
})
