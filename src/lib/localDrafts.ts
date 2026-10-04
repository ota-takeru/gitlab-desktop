import { invoke, isTauri as tauriIsTauri } from '@tauri-apps/api/core'

export interface LocalDraft {
  body: string
  updatedAt: number
}

export function isDesktopRuntime(): boolean {
  return tauriIsTauri()
}

export async function getLocalDraft(sessionId: string, key: string): Promise<LocalDraft | null> {
  if (!isDesktopRuntime()) return null
  return invoke<LocalDraft | null>('get_local_draft', { sessionId, key })
}

export async function setLocalDraft(sessionId: string, key: string, body: string): Promise<void> {
  if (!isDesktopRuntime()) return
  await invoke<void>('set_local_draft', { sessionId, key, body })
}

export async function clearLocalDrafts(sessionId: string): Promise<void> {
  if (!isDesktopRuntime()) return
  await invoke<void>('clear_local_drafts', { sessionId })
}
