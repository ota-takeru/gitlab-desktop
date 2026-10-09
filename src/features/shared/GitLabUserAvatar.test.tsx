import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { avatarMock } = vi.hoisted(() => ({ avatarMock: vi.fn() }))
vi.mock('../../lib/gitlab', () => ({ getGitLabAvatar: avatarMock }))

import { GitLabUserAvatar } from './GitLabUserAvatar'

const user = { id: '7', name: 'Alice Example', username: 'alice', avatarUrl: 'https://gitlab.example/uploads/-/system/user/avatar/7/a.png' }

describe('GitLabUserAvatar', () => {
  beforeEach(() => avatarMock.mockReset())

  it('shows the image returned by the native side', async () => {
    avatarMock.mockResolvedValue('data:image/png;base64,AAAA')
    const { container } = render(<GitLabUserAvatar sessionId="session-a" user={user} />)
    await waitFor(() => expect(container.querySelector('img')).toHaveAttribute('src', 'data:image/png;base64,AAAA'))
    expect(avatarMock).toHaveBeenCalledWith('session-a', user.avatarUrl)
  })

  it('keeps the initial when the avatar is unavailable or not provided', async () => {
    avatarMock.mockResolvedValue(null)
    const { container } = render(<><GitLabUserAvatar sessionId="session-b" user={user} /><GitLabUserAvatar sessionId="session-b" user={{ ...user, avatarUrl: null, id: '8' }} /></>)
    await waitFor(() => expect(avatarMock).toHaveBeenCalledTimes(1))
    expect(container.querySelector('img')).toBeNull()
    expect(container).toHaveTextContent('AA')
  })
})
