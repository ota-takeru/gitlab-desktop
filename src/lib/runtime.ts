import { invoke, isTauri as tauriIsTauri } from '@tauri-apps/api/core'

import type { RuntimeInfo } from '../types/runtime'

export function isTauri(): boolean {
  return tauriIsTauri()
}

export function getRuntimeInfo(): Promise<RuntimeInfo> {
  return invoke<RuntimeInfo>('runtime_info')
}
