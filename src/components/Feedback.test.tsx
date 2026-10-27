import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'

import { FeedbackProvider } from './Feedback'
import { useNotify } from './feedbackContext'

function Trigger({ celebrate }: { celebrate?: boolean }) {
  const notify = useNotify()
  return <button onClick={() => notify({ celebrate, message: '!42 を承認しました', severity: 'success' })} type="button">notify</button>
}

it('fills a milestone notice and pops its mark in, and keeps an ordinary one outlined', () => {
  const { unmount } = render(<FeedbackProvider><Trigger celebrate /></FeedbackProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'notify' }))
  const alert = screen.getByRole('alert')
  expect(alert).toHaveTextContent('!42 を承認しました')
  expect(alert.className).toContain('MuiAlert-filled')
  expect(alert.querySelector('[data-testid="CheckCircleRoundedIcon"]')).toBeInTheDocument()
  unmount()

  render(<FeedbackProvider><Trigger /></FeedbackProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'notify' }))
  expect(screen.getByRole('alert').className).toContain('MuiAlert-outlined')
})
