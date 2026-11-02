import { invoke } from '@tauri-apps/api/core'
import { isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification'
import { isTauri } from './runtime'

export async function enableDesktopNotifications(): Promise<boolean> {
  if (!isTauri()) return false
  if (await isPermissionGranted()) return true
  return await requestPermission() === 'granted'
}
/** Shows a notification; a click on it brings the app forward and opens `url`, a GitLab page on the connected instance. */
export async function notifyWorkspace(body: string, url?: string): Promise<void> {
  if (!isTauri()) return
  if (!await isPermissionGranted()) return
  await invoke('plugin:notification|notify', { options: { title: 'GitLab Desktop', body, ...(url ? { extra: { url } } : {}) } })
}
