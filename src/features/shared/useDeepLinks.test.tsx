import { render, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  current: null as string[] | null,
  listener: null as ((links: string[]) => void) | null,
}))
vi.mock('@tauri-apps/plugin-deep-link', () => ({
  getCurrent: async () => mocks.current,
  onOpenUrl: async (handler: (links: string[]) => void) => { mocks.listener = handler; return () => { mocks.listener = null } },
}))
vi.mock('../../lib/runtime', () => ({ isTauri: () => true }))

import { useDeepLinks } from './useDeepLinks'

const instance = 'https://gitlab.example'
const link = (url: string) => `gitlab-desktop://open?url=${encodeURIComponent(url)}`

function Probe({ open, instanceUrl }: { open?: (url: string) => void; instanceUrl?: string }) {
  useDeepLinks(open, instanceUrl)
  return null
}

beforeEach(() => {
  mocks.current = null
  mocks.listener = null
})

it('opens the start link once the connection is ready, and later links as they come', async () => {
  mocks.current = [link('https://gitlab.example/team/app/-/merge_requests/3')]
  const open = vi.fn()
  const { rerender } = render(<Probe />)
  await waitFor(() => expect(mocks.listener).not.toBeNull())
  expect(open).not.toHaveBeenCalled()

  rerender(<Probe instanceUrl={instance} open={open} />)
  expect(open).toHaveBeenCalledWith('https://gitlab.example/team/app/-/merge_requests/3')

  mocks.listener?.([link('https://gitlab.example/team/app'), link('https://evil.example/x')])
  expect(open).toHaveBeenCalledTimes(2)
  expect(open).toHaveBeenLastCalledWith('https://gitlab.example/team/app')
})
