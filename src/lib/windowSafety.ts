import { invoke, isTauri as tauriIsTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

import { composerTargetName, discardComposerBuffers, flushComposerBuffers, listUnsafeComposerTargets } from '../features/mergeRequests/useComposerBuffer'

const CLOSE_EVENT = 'app-close-blocked'
const GUARD_COMMAND = 'set_window_close_guard'
const CLOSE_COMMAND = 'close_app_window'
/** The close confirmation names at most this many places with unsent input. */
const MAX_LISTED_TARGETS = 10

let latestUnsafe = false
/** The keys of what holds the window open (see AutoUpdateSafety), to name each place in the confirmation. */
let latestSources: readonly string[] = []
let listenerPromise: Promise<void> | null = null
let initializationPromise: Promise<void> | null = null
let guardWriteTail: Promise<void> = Promise.resolve()
let closeRequest: Promise<void> | null = null
let beforeUnloadRegistered = false

/** One place listed in the confirmation: the screen, and what in it is not sent. */
export interface CloseItem {
  name: string
  detail?: string
}

export interface CloseConfirmation {
  title: string
  message?: string
  /** Places listed under the message, such as the MRs that hold unsent input. */
  items?: CloseItem[]
  confirmLabel: string
  cancelLabel?: string
  destructive?: boolean
}

export type CloseChoice = 'confirm' | 'alternative' | 'cancel'

export interface CloseDialogs {
  confirm: (options: CloseConfirmation) => Promise<boolean>
  /** A confirmation with a second way forward, `alternativeLabel`. */
  choose: (options: CloseConfirmation & { alternativeLabel: string }) => Promise<CloseChoice>
  notify: (message: string) => void
}

const itemLine = ({ detail, name }: CloseItem) => detail ? `${name} — ${detail}` : name

/** The browser's own dialogs until the themed ones are mounted, and again after they unmount. */
const nativeDialogs: CloseDialogs = {
  confirm: async ({ items, message, title }) => globalThis.confirm([title, message, ...(items ?? []).map(itemLine)].filter(Boolean).join('\n')),
  // The browser's dialog has two buttons, so leaving without saving is offered only in the app's.
  choose: async (options) => await nativeDialogs.confirm(options) ? 'confirm' : 'cancel',
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

export function setLatestWindowUnsafe(unsafe: boolean, sources: readonly string[] = []): void {
  // This is intentionally a synchronous assignment. The native close event
  // can arrive between React render and its effect, so it must see the newest
  // safety state even while the IPC write is queued.
  latestUnsafe = unsafe
  latestSources = sources
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
  const choice = unsafe ? await closeDialogs.choose({
    alternativeLabel: '保存せずに終了',
    cancelLabel: '戻る',
    confirmLabel: '保存して終了',
    items: unsentItems(),
    message: '次の画面に未送信の入力、編集中の内容、または結果未確認の操作があります。「保存して終了」は入力を端末に保存し、次回復元します。「保存せずに終了」は未送信の入力を破棄します（結果未確認の操作の記録は残ります）。',
    title: '未送信の内容があります',
  }) : 'confirm'
  if (choice === 'cancel') return
  if (choice === 'alternative') {
    // A discard that could not be written leaves the saved copy, which comes back next time; closing goes on.
    await discardComposerBuffers().catch(() => false)
    await closeWindow()
    return
  }

  const flushed = await flushComposerBuffers().catch(() => false)

  if (!flushed && !await closeDialogs.confirm({
    cancelLabel: '戻る',
    confirmLabel: '内容を失って終了',
    destructive: true,
    message: '未送信の入力を端末に保存できませんでした。このまま終了すると入力は失われます。',
    title: '入力を保存できませんでした',
  })) return

  await closeWindow()
}

async function closeWindow(): Promise<void> {
  try {
    await invoke<void>(CLOSE_COMMAND)
  } catch {
    closeDialogs.notify('アプリを終了できませんでした。')
  }
}

/**
 * Each place holding unsent work: 「group/project !12 タイトル」 with what in it (新しいコメント, 説明の編集...),
 * then how many more there are. Typed text comes from the inputs; edits and writes from what holds the window.
 */
function unsentItems(): CloseItem[] | undefined {
  const places = new Map<string, { name: string; details: string[] }>()
  const add = (key: string, name: string, detail: string) => {
    const place = places.get(key) ?? { details: [], name }
    if (!place.details.includes(detail)) place.details.push(detail)
    places.set(key, place)
  }
  const mergeRequestName = (projectId: string, iid: string, label: { projectPath?: string; title?: string }) => [`${label.projectPath || `プロジェクト ${projectId}`} !${iid}`, label.title].filter(Boolean).join(' ')
  for (const target of listUnsafeComposerTargets()) {
    for (const input of target.inputs) add(`mr:${target.projectId}:${target.iid}`, mergeRequestName(target.projectId, target.iid, target), input)
  }
  for (const source of latestSources) {
    const description = /^description-edit:[^:]*:([1-9]\d*):([1-9]\d*)$/u.exec(source)
    const write = /^review:[^:]*:([1-9]\d*):([1-9]\d*):/u.exec(source)
    const [, projectId, iid] = description ?? write ?? []
    if (projectId && iid) add(`mr:${projectId}:${iid}`, mergeRequestName(projectId, iid, composerTargetName(projectId, iid)), description ? '説明の編集' : '送信中または結果未確認の操作')
    else if (source === 'pat-form') add('settings', '設定', 'アクセストークンの入力')
  }
  if (!places.size) return undefined
  const items = [...places.values()].map(({ details, name }) => ({ detail: details.join('、'), name }))
  return items.length > MAX_LISTED_TARGETS ? [...items.slice(0, MAX_LISTED_TARGETS), { name: `ほか${items.length - MAX_LISTED_TARGETS}件` }] : items
}
