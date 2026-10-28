import { invoke } from '@tauri-apps/api/core'

import { translate } from '../i18n/i18n'
import { isTauri } from './runtime'

export interface AppUpdate {
  configured: boolean
  version: string | null
  notes: string | null
  /** The signed package of `version` is already downloaded and verified. */
  downloaded?: boolean
}

const NOT_CONFIGURED: AppUpdate = Object.freeze({
  configured: false,
  version: null,
  notes: null,
  downloaded: false,
})

/**
 * Checks the fixed updater endpoint configured by the signed desktop build.
 * Browser previews intentionally never invoke a Tauri command.
 */
export async function checkAppUpdate(): Promise<AppUpdate> {
  if (!isTauri()) {
    return NOT_CONFIGURED
  }
  return invoke<AppUpdate>('check_app_update')
}

/**
 * Downloads and verifies the update found by the last check, in the background.
 * It never installs or restarts.
 */
export async function downloadAppUpdate(): Promise<void> {
  if (!isTauri()) {
    throw new Error(translate('common.update.browserUnavailable'))
  }
  await invoke<void>('download_app_update')
}

/**
 * Installs the downloaded update (downloading it first if needed) and restarts the app.
 * The UI calls this only after an explicit user action.
 */
export function installAppUpdate(): Promise<void> {
  if (!isTauri()) {
    return Promise.reject(new Error(translate('common.update.browserUnavailable')))
  }
  return invoke<void>('install_app_update')
}
