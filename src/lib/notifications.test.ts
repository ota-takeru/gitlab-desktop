import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  isPermissionGranted: vi.fn(),
  requestPermission: vi.fn(),
  isTauri: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('@tauri-apps/plugin-notification', () => ({
  isPermissionGranted: mocks.isPermissionGranted,
  requestPermission: mocks.requestPermission,
}))
vi.mock('./runtime', () => ({ isTauri: mocks.isTauri }))

import { enableDesktopNotifications, notifyWorkspace } from './notifications'

describe('desktop workspace notifications', () => {
  beforeEach(() => {
    mocks.invoke.mockReset().mockResolvedValue(undefined)
    mocks.isPermissionGranted.mockReset()
    mocks.requestPermission.mockReset()
    mocks.isTauri.mockReset().mockReturnValue(true)
  })

  it('checks an existing grant before notifying and never requests permission from the notify path', async () => {
    mocks.isPermissionGranted.mockResolvedValue(true)

    await notifyWorkspace('新しいコメントがあります。')

    expect(mocks.isPermissionGranted).toHaveBeenCalledTimes(1)
    expect(mocks.requestPermission).not.toHaveBeenCalled()
    expect(mocks.invoke).toHaveBeenCalledWith('plugin:notification|notify', {
      options: { title: 'GitLab Desktop', body: '新しいコメントがあります。' },
    })
  })

  it('refuses notification emission when permission is denied', async () => {
    mocks.isPermissionGranted.mockResolvedValue(false)

    await notifyWorkspace('新しいTo-Doがあります。')

    expect(mocks.requestPermission).not.toHaveBeenCalled()
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('requests OS permission only from the explicit enable action and guards browser runtime', async () => {
    mocks.isPermissionGranted.mockResolvedValue(false)
    mocks.requestPermission.mockResolvedValue('granted')

    await expect(enableDesktopNotifications()).resolves.toBe(true)
    expect(mocks.requestPermission).toHaveBeenCalledTimes(1)

    mocks.isTauri.mockReturnValue(false)
    await expect(notifyWorkspace('ignored')).resolves.toBeUndefined()
    await expect(enableDesktopNotifications()).resolves.toBe(false)
    expect(mocks.isPermissionGranted).toHaveBeenCalledTimes(1)
    expect(mocks.requestPermission).toHaveBeenCalledTimes(1)
    expect(mocks.invoke).not.toHaveBeenCalled()
  })
})
