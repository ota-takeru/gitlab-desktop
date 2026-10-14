import { invoke, isTauri as tauriIsTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

import { flushComposerBuffers, listUnsafeComposerTargets } from '../features/mergeRequests/useComposerBuffer'

const CLOSE_EVENT = 'app-close-blocked'
const GUARD_COMMAND = 'set_window_close_guard'
const CLOSE_COMMAND = 'close_app_window'
/** The close confirmation names at most this many MRs with unsent input. */
const MAX_LISTED_TARGETS = 10

let latestUnsafe = false
let listenerPromise: Promise<void> | null = null
let initializationPromise: Promise<void> | null = null
let guardWriteTail: Promise<void> = Promise.resolve()
let closeRequest: Promise<void> | null = null
let beforeUnloadRegistered = false

export interface CloseConfirmation {
  title: string
  message?: string
  /** Lines listed under the message, such as the MRs that hold unsent input. */
  items?: string[]
  confirmLabel: string
  cancelLabel?: string
  destructive?: boolean
}

export interface CloseDialogs {
  confirm: (options: CloseConfirmation) => Promise<boolean>
  notify: (message: string) => void
}

/** The browser's own dialogs until the themed ones are mounted, and again after they unmount. */
const nativeDialogs: CloseDialogs = {
  confirm: async ({ items, message, title }) => globalThis.confirm([title, message, ...items ?? []].filter(Boolean).join('\n')),
  notify: (message) => globalThis.alert(message),
}
let closeDialogs: CloseDialogs = nativeDialogs

/**
 * The close flow already runs asynchronously from the native event, so it can
 * wait for themed dialogs. Returns the function that restores the browser's.
 */
export function setCloseDialogs(dialogs: CloseDialogs): () => void {
  closeDialogs = dialogs
  return () => {
    if (closeDialogs === dialogs) closeDialogs = nativeDialogs
  }
}

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
  if (unsafe && !await closeDialogs.confirm({
    cancelLabel: '戻る',
    confirmLabel: '保存して終了',
    items: unsentTargetLines(),
    message: '未送信の入力、編集中の内容、または結果未確認の投稿があります。入力を端末に保存してから終了します。保存した未送信コメントは次回復元されます。',
    title: '未送信の内容があります',
  })) return

  const flushed = await flushComposerBuffers().catch(() => false)

  if (!flushed && !await closeDialogs.confirm({
    cancelLabel: '戻る',
    confirmLabel: '内容を失って終了',
    destructive: true,
    message: '未送信の入力を端末に保存できませんでした。このまま終了すると入力は失われます。',
    title: '入力を保存できませんでした',
  })) return

  try {
    await invoke<void>(CLOSE_COMMAND)
  } catch {
    closeDialogs.notify('アプリを終了できませんでした。')
  }
}

/** 「group/project !12 タイトル」 for each MR with unsent input, then how many more there are. */
function unsentTargetLines(): string[] | undefined {
  const targets = listUnsafeComposerTargets()
  if (!targets.length) return undefined
  const lines = targets.slice(0, MAX_LISTED_TARGETS).map(({ iid, projectId, projectPath, title }) => [`${projectPath || `プロジェクト ${projectId}`} !${iid}`, title].filter(Boolean).join(' '))
  return targets.length > MAX_LISTED_TARGETS ? [...lines, `ほか${targets.length - MAX_LISTED_TARGETS}件`] : lines
}
