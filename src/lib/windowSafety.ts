import { invoke, isTauri as tauriIsTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

import { flushComposerBuffers } from '../features/mergeRequests/useComposerBuffer'

const CLOSE_EVENT = 'app-close-blocked'
const GUARD_COMMAND = 'set_window_close_guard'
const CLOSE_COMMAND = 'close_app_window'

let latestUnsafe = false
let listenerPromise: Promise<void> | null = null
let initializationPromise: Promise<void> | null = null
let guardWriteTail: Promise<void> = Promise.resolve()
let closeRequest: Promise<void> | null = null
let beforeUnloadRegistered = false

export function setLatestWindowUnsafe(unsafe: boolean): void {
  // This is intentionally a synchronous assignment. The native close event
  // can arrive between React render and its effect, so it must see the newest
  // safety state even while the IPC write is queued.
  latestUnsafe = unsafe
}

export function ensureBeforeUnloadProtection(): void {
  if (beforeUnloadRegistered) return
  beforeUnloadRegistered = true
  globalThis.addEventListener('beforeunload', handleBeforeUnload)
}

function handleBeforeUnload(event: BeforeUnloadEvent): void {
  if (!latestUnsafe) return
  event.preventDefault()
  event.returnValue = ''
}

export function queueWindowCloseGuard(unsafe: boolean): Promise<void> {
  latestUnsafe = unsafe
  const next = guardWriteTail.then(() => invoke<void>(GUARD_COMMAND, { unsafeToClose: unsafe }))
  guardWriteTail = next.catch(() => undefined)
  return next
}

async function registerCloseListener(): Promise<void> {
  await listen<boolean>(CLOSE_EVENT, (event) => {
    requestClose(Boolean(event.payload) || latestUnsafe)
  })
}

function ensureCloseListener(): Promise<void> {
  if (listenerPromise) return listenerPromise
  const next = registerCloseListener().catch((error: unknown) => {
    listenerPromise = null
    throw error
  })
  listenerPromise = next
  return next
}

/** Register the event first, then enable native interception with the current state. */
export function initializeWindowCloseProtection(): Promise<void> {
  ensureBeforeUnloadProtection()
  if (!tauriIsTauri()) return Promise.resolve()
  if (initializationPromise) return initializationPromise

  const next = ensureCloseListener().then(() => queueWindowCloseGuard(latestUnsafe))
  initializationPromise = next.finally(() => {
    initializationPromise = null
  })
  return initializationPromise
}

export function requestClose(unsafeFromNative = false): void {
  if (closeRequest) return
  const next = processCloseRequest(unsafeFromNative || latestUnsafe)
  closeRequest = next.finally(() => {
    closeRequest = null
  })
  // The listener cannot await a Tauri event callback. Keep failures contained
  // so an unexpected runtime error never becomes an unhandled rejection.
  void closeRequest.catch(() => undefined)
}

async function processCloseRequest(unsafe: boolean): Promise<void> {
  if (unsafe && !globalThis.confirm('未送信の入力、編集中の内容、または結果未確認の投稿があります。端末への保存を待って終了しますか？保存済みの未送信コメントは次回復元されます。')) return

  const flushed = await flushComposerBuffers().catch(() => false)

  if (!flushed && !globalThis.confirm('未保存の内容を保存できませんでした。内容を失って終了しますか？')) return

  try {
    await invoke<void>(CLOSE_COMMAND)
  } catch {
    globalThis.alert('アプリを終了できませんでした。')
  }
}
