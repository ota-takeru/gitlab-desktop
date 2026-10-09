import { invoke } from '@tauri-apps/api/core'
import { isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification'
import { isTauri } from './runtime'

export async function enableDesktopNotifications(): Promise<boolean> {
  if (!isTauri()) return false
  if (await isPermissionGranted()) return true
  return await requestPermission() === 'granted'
}
export async function notifyWorkspace(body: string): Promise<void> {
  if (!isTauri()) return
  if (!await isPermissionGranted()) return
  await invoke('plugin:notification|notify', { options: { title: 'GitLab Desktop', body } })
}
