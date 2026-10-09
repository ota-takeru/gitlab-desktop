import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Pager } from './Pager'
import { PipelineStatus } from './PipelineStatus'

describe('Pager', () => {
  it('stays hidden when there is only one page', () => {
    const { container } = render(<Pager hasNext={false} hasPrevious={false} onNext={vi.fn()} onPrevious={vi.fn()} page={1} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('moves between pages and disables unavailable directions', () => {
    const onNext = vi.fn()
    render(<Pager hasNext hasPrevious={false} onNext={onNext} onPrevious={vi.fn()} page={1} />)
    expect(screen.getByRole('button', { name: '前へ' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '次へ' }))
    expect(onNext).toHaveBeenCalledTimes(1)
    expect(screen.getByText('ページ 1')).toBeInTheDocument()
  })
})

describe('PipelineStatus', () => {
  it('labels known and unknown pipeline states with text, not color alone', () => {
    render(<><PipelineStatus status="failed" /><PipelineStatus status="mystery" /><PipelineStatus status={null} /></>)
    expect(screen.getByLabelText('CI 失敗')).toBeInTheDocument()
    expect(screen.getByLabelText('CI mystery')).toBeInTheDocument()
    expect(screen.getByLabelText('CI 状態不明')).toBeInTheDocument()
  })
})
