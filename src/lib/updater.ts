import { invoke } from '@tauri-apps/api/core'

import { isTauri } from './runtime'

export interface AppUpdate {
  configured: boolean
  version: string | null
  notes: string | null
}

const NOT_CONFIGURED: AppUpdate = Object.freeze({
  configured: false,
  version: null,
  notes: null,
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
 * Installs the update selected by the Rust updater command and restarts the app.
 * The UI calls this only after an explicit user action.
 */
export function installAppUpdate(): Promise<void> {
  if (!isTauri()) {
    return Promise.reject(new Error('ブラウザプレビューではアプリを更新できません。'))
  }
  return invoke<void>('install_app_update')
}
