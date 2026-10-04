import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useLayoutEffect } from 'react'

import { AppErrorBoundary } from './AppErrorBoundary'

function ThrowOnce() {
  useLayoutEffect(() => {
    if (!throwOnce) return
    throwOnce = false
    throw new Error('private token=super-secret merge request body')
  }, [])
  return <div>復旧した画面</div>
}

let throwOnce = true

function AlwaysThrows(): never {
  throw new Error('private token=super-secret')
}

afterEach(() => {
  throwOnce = true
  window.history.replaceState(null, '', '/')
})

describe('AppErrorBoundary', () => {
  it('shows a safe fallback and remounts the failed subtree on retry', () => {
    render(
      <AppErrorBoundary>
        <ThrowOnce />
      </AppErrorBoundary>,
      { onCaughtError: () => undefined },
    )

    expect(screen.getByRole('heading', { name: '画面を表示できません' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '再表示' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '接続設定へ移動' })).toBeInTheDocument()
    expect(screen.queryByText('復旧した画面')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '再表示' }))

    expect(screen.getByText('復旧した画面')).toBeInTheDocument()
    expect(screen.queryByText(/アプリを再起動してください/u)).not.toBeInTheDocument()
  })

  it('never renders exception details and recommends restarting after a failed retry', () => {
    render(
      <AppErrorBoundary>
        <AlwaysThrows />
      </AppErrorBoundary>,
      { onCaughtError: () => undefined },
    )

    const containerText = document.body.textContent ?? ''
    expect(containerText).not.toContain('super-secret')
    expect(containerText).not.toContain('merge request body')
    expect(screen.queryByText(/Error/u)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '再表示' }))

    expect(screen.getByText(/再表示しても画面を表示できませんでした/u)).toBeInTheDocument()
    expect(screen.getByText(/アプリを再起動してください/u)).toBeInTheDocument()
  })

  it('moves to connection settings without exposing the original exception', () => {
    render(
      <AppErrorBoundary>
        <AlwaysThrows />
      </AppErrorBoundary>,
      { onCaughtError: () => undefined },
    )

    fireEvent.click(screen.getByRole('button', { name: '接続設定へ移動' }))

    expect(window.location.hash).toBe('#client/settings')
    expect(screen.queryByText('private token=super-secret')).not.toBeInTheDocument()
  })
})
