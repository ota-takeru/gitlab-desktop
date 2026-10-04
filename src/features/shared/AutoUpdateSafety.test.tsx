import { fireEvent, render, screen } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { describe, expect, it } from 'vitest'

import { ReviewComposer } from '../mergeRequests/ReviewComposer'
import { AutoUpdateSafetyProvider, useAutoUpdateAllowed, useAutoUpdateSafety } from './AutoUpdateSafety'

function SafetyIndicator() {
  return <output data-testid="safe">{useAutoUpdateAllowed() ? 'safe' : 'unsafe'}</output>
}

function BufferedComposerHarness({ mounted }: { mounted: boolean }) {
  return mounted ? <MountedBufferedComposer /> : null
}

function MountedBufferedComposer() {
  const [body, setBody] = useState('')
  const { setUnsafe } = useAutoUpdateSafety('composer:test', { persistOnUnmount: true })
  useEffect(() => setUnsafe(Boolean(body)), [body, setUnsafe])
  return <ReviewComposer onCancelReply={() => undefined} onChange={setBody} onClearPosition={() => undefined} onSaveDraft={async () => true} onSubmitComment={async () => true} value={body} />
}

describe('auto update safety', () => {
  it('keeps the updater blocked when a composer with buffered text is hidden', () => {
    const view = render(<AutoUpdateSafetyProvider><BufferedComposerHarness mounted /><SafetyIndicator /></AutoUpdateSafetyProvider>)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '未送信の本文' } })
    expect(screen.getByTestId('safe')).toHaveTextContent('unsafe')

    view.rerender(<AutoUpdateSafetyProvider><BufferedComposerHarness mounted={false} /><SafetyIndicator /></AutoUpdateSafetyProvider>)
    expect(screen.getByTestId('safe')).toHaveTextContent('unsafe')
  })

  it('disables editing while a comment request is pending', () => {
    render(<ReviewComposer onCancelReply={() => undefined} onChange={() => undefined} onClearPosition={() => undefined} onSaveDraft={async () => false} onSubmitComment={async () => false} pending value="送信中の本文" />)
    expect(screen.getByRole('textbox')).toBeDisabled()
  })
})
