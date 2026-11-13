import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getGitLabImage = vi.hoisted(() => vi.fn((_session: string, url: string) => Promise.resolve(`data:${url}`)))
vi.mock('../../lib/gitlab', () => ({ getGitLabImage }))

import { useGitLabImage } from './useGitLabImage'

async function show(session: string, url: string) {
  const { result, unmount } = renderHook(() => useGitLabImage(session, url))
  await waitFor(() => expect(result.current.ready).toBe(true))
  unmount()
}

describe('GitLab image cache', () => {
  beforeEach(() => { globalThis.dispatchEvent(new Event('gitlab-explicit-logout')); getGitLabImage.mockClear() })

  it('lets go of the image unused longest when full, keeping the others', async () => {
    for (let index = 1; index <= 16; index += 1) await show('s', `u${index}`)
    await show('s', 'u1')
    expect(getGitLabImage).toHaveBeenCalledTimes(16)
    await show('s', 'u17')
    getGitLabImage.mockClear()
    for (let index = 3; index <= 17; index += 1) await show('s', `u${index}`)
    await show('s', 'u1')
    expect(getGitLabImage).not.toHaveBeenCalled()
    await show('s', 'u2')
    expect(getGitLabImage).toHaveBeenCalledTimes(1)
    expect(getGitLabImage).toHaveBeenLastCalledWith('s', 'u2')
  })

  it('fetches again after an account replacement', async () => {
    await show('s', 'a')
    globalThis.dispatchEvent(new Event('gitlab-account-replaced'))
    await show('s', 'a')
    expect(getGitLabImage).toHaveBeenCalledTimes(2)
  })
})
