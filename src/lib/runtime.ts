import { invoke, isTauri as tauriIsTauri } from '@tauri-apps/api/core'

import type { RuntimeInfo } from '../types/runtime'

export function isTauri(): boolean {
  return tauriIsTauri()
}

export function getRuntimeInfo(): Promise<RuntimeInfo> {
  return invoke<RuntimeInfo>('runtime_info')
}

/** Tells the native side the interface language, which decides how files that are not UTF-8 are read. */
export function setTextLanguage(language: string): Promise<void> {
  return invoke('set_text_language', { language })
}
