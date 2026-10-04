import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ReviewComposer } from './ReviewComposer'

describe('ReviewComposer', () => {
  it('ignores a second Ctrl+Enter while the first submission is flushing', async () => {
    let resolveSubmit!: (success: boolean) => void
    const onSaveDraft = vi.fn(() => new Promise<boolean>((resolve) => { resolveSubmit = resolve }))
    const onChange = vi.fn()
    render(<ReviewComposer onCancelReply={() => undefined} onChange={onChange} onClearPosition={() => undefined} onSaveDraft={onSaveDraft} onSubmitComment={async () => true} value="本文" />)

    const textbox = screen.getByRole('textbox', { name: 'コメント本文' })
    fireEvent.keyDown(textbox, { ctrlKey: true, key: 'Enter' })
    fireEvent.keyDown(textbox, { ctrlKey: true, key: 'Enter' })

    expect(onSaveDraft).toHaveBeenCalledTimes(1)
    expect(textbox).toBeDisabled()

    await act(async () => resolveSubmit(true))
    expect(onChange).toHaveBeenCalledWith('')
  })
})
