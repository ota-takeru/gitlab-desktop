import { useMemo, useSyncExternalStore } from 'react'
import type { GitLabSession, Note } from '../../types/gitlab'
import { scopedKey, type PreferenceScope } from './preferences'

export interface MrRef { projectId: string; iid: string }
export interface WorkspaceSettings {
  autoRefresh: boolean
  notifyComments: boolean
  notifyTodos: boolean
  /** Shows MR comments, pushes, approvals and state changes among the notifications, as GitLab's emails do. */
  showActivity: boolean
}
interface Reading { known: Record<string, string>; read: Record<string, string> }
/** What a sidebar tab shows, as of the last time the MR was seen; kept so tabs need no requests. */
export interface TabMeta { title: string; state: string; projectPath: string }
interface WorkspaceData {
  pinned: MrRef[]
  /** MRs open as sidebar tabs (not pinned), newest first. */
  open: MrRef[]
  /** When each open tab was last shown (ISO time); a tab not shown for `STALE_TAB_MS` closes. */
  shown: Record<string, string>
  tabs: Record<string, TabMeta>
  recent: MrRef[]
  reading: Record<string, Reading>
  /** When MR events started being followed (ISO time); earlier ones never count as unread. */
  activitySince?: string
  /** Per MR, the time up to which its events are read. */
  activityRead: Record<string, string>
  settings: WorkspaceSettings
}
export const defaultWorkspaceSettings: WorkspaceSettings = { autoRefresh: true, notifyComments: false, notifyTodos: false, showActivity: true }
const changedEvent = 'gitlab-workspace-preferences-change'
export function mrRefKey(ref: MrRef): string { return `${ref.projectId}:${ref.iid}` }
const emptyData = (): WorkspaceData => ({ pinned: [], open: [], shown: {}, tabs: {}, recent: [], reading: {}, activityRead: {}, settings: { ...defaultWorkspaceSettings } })
const MAX_OPEN_TABS = 20
/** Open tabs stay mounted with their data, so ones not shown for three days close. */
export const STALE_TAB_MS = 3 * 24 * 60 * 60_000
/** Showing a tab again records the time only this long after the last record, so switching tabs rarely writes. */
const SHOWN_RESOLUTION_MS = 60 * 60_000
const validRef = (ref: unknown): ref is MrRef => Boolean(ref && typeof ref === 'object' && /^[1-9]\d*$/u.test((ref as MrRef).projectId) && /^[1-9]\d*$/u.test((ref as MrRef).iid))
function refs(value: unknown, max: number): MrRef[] {
  return Array.isArray(value) ? value.filter(validRef).filter((ref, index, all) => all.findIndex((other) => mrRefKey(other) === mrRefKey(ref)) === index).slice(0, max) : []
}
function timestamps(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {}
  return Object.fromEntries(Object.entries(value).filter(([id, date]) => /^[1-9]\d*$/u.test(id) && typeof date === 'string' && Number.isFinite(Date.parse(date))).slice(-2000))
}
function tabMeta(value: unknown): Record<string, TabMeta> {
  if (!value || typeof value !== 'object') return {}
  return Object.fromEntries(Object.entries(value as Record<string, Partial<TabMeta> | null>)
    .filter((entry): entry is [string, TabMeta] => /^[1-9]\d*:[1-9]\d*$/u.test(entry[0]) && typeof entry[1]?.title === 'string' && typeof entry[1].state === 'string' && typeof entry[1].projectPath === 'string')
    .map(([ref, meta]) => [ref, { projectPath: meta.projectPath.slice(0, 500), state: meta.state.slice(0, 40), title: meta.title.slice(0, 500) }]))
}
function key(scope: PreferenceScope) { return scopedKey(scope, 'personal-workspace') }
function storedWorkspace(scope: PreferenceScope): string {
  try { return localStorage.getItem(key(scope)) ?? '' } catch { return '' }
}
/** A fresh copy that the caller may change and save; copied from the parsed snapshot, so writes do not validate every read marker again. */
export function readWorkspace(scope: PreferenceScope): WorkspaceData {
  return structuredClone(readWorkspaceSnapshot(scope))
}
let snapshot: { key: string; raw: string; data: WorkspaceData } | null = null
/**
 * The stored workspace for reading only. Parsing validates every read marker
 * (up to 16,000), so it is parsed again only when the stored text changes.
 */
function readWorkspaceSnapshot(scope: PreferenceScope): WorkspaceData {
  const storageKey = key(scope)
  const raw = storedWorkspace(scope)
  if (snapshot?.key !== storageKey || snapshot.raw !== raw) snapshot = { data: parseWorkspace(raw), key: storageKey, raw }
  return snapshot.data
}
function parseWorkspace(raw: string): WorkspaceData {
  try {
    if (!raw) return emptyData()
    const value = JSON.parse(raw) as Partial<WorkspaceData>
    const reading: Record<string, Reading> = {}
    if (value.reading && typeof value.reading === 'object') {
      for (const [ref, record] of Object.entries(value.reading).slice(-200)) {
        if (/^[1-9]\d*:[1-9]\d*$/u.test(ref) && record && typeof record === 'object') reading[ref] = { known: timestamps(record.known), read: timestamps(record.read) }
      }
    }
    const pinned = refs(value.pinned, 100)
    const open = refs(value.open, MAX_OPEN_TABS).filter((ref) => !pinned.some((item) => mrRefKey(item) === mrRefKey(ref)))
    const shown = Object.fromEntries(Object.entries(value.shown && typeof value.shown === 'object' ? value.shown : {})
      .filter(([ref, date]) => open.some((item) => mrRefKey(item) === ref) && typeof date === 'string' && Number.isFinite(Date.parse(date))))
    const activityRead = Object.fromEntries(Object.entries(value.activityRead && typeof value.activityRead === 'object' ? value.activityRead : {})
      .filter(([ref, date]) => /^[1-9]\d*:[1-9]\d*$/u.test(ref) && typeof date === 'string' && Number.isFinite(Date.parse(date))).slice(-200))
    const activitySince = typeof value.activitySince === 'string' && Number.isFinite(Date.parse(value.activitySince)) ? value.activitySince : undefined
    return { pinned, open, shown, tabs: tabMeta(value.tabs), recent: refs(value.recent, 30), reading, activityRead, ...(activitySince ? { activitySince } : {}), settings: {
      autoRefresh: value.settings?.autoRefresh !== false,
      notifyComments: value.settings?.notifyComments === true,
      notifyTodos: value.settings?.notifyTodos === true,
      showActivity: value.settings?.showActivity !== false,
    } }
  } catch { return emptyData() }
}
function save(scope: PreferenceScope, data: WorkspaceData) {
  // Titles are kept only for MRs the sidebar or the history can show.
  const kept = new Set([...data.pinned, ...data.open, ...data.recent].map(mrRefKey))
  data.tabs = Object.fromEntries(Object.entries(data.tabs).filter(([ref]) => kept.has(ref)))
  const open = new Set(data.open.map(mrRefKey))
  data.shown = Object.fromEntries(Object.entries(data.shown).filter(([ref]) => open.has(ref)))
  const text = JSON.stringify(data)
  try {
    if (localStorage.getItem(key(scope)) === text) return
    localStorage.setItem(key(scope), text)
    globalThis.dispatchEvent(new Event(changedEvent))
  } catch { /* Reading markers and shortcuts remain optional. */ }
}
// Once read, a comment stays read even when GitLab later moves its updatedAt.
function stamp(note: Note) { return note.createdAt }
/** With `complete`, notes are the whole loaded view, so known comments missing from it (deleted ones) stop counting as unread. */
export function observeComments(scope: PreferenceScope, ref: MrRef, notes: Note[], currentUserId: string, markRead = false, complete = false) {
  if (!validRef(ref)) return
  const data = readWorkspace(scope)
  const refKey = mrRefKey(ref)
  const record = data.reading[refKey] ?? { known: {}, read: {} }
  const observed = new Set<string>()
  let changed = false
  for (const note of notes) {
    if (note.system || !/^[1-9]\d*$/u.test(note.id) || !Number.isFinite(Date.parse(stamp(note)))) continue
    const date = stamp(note)
    observed.add(note.id)
    if (record.known[note.id] !== date) { record.known[note.id] = date; changed = true }
    if ((markRead || note.author.id === currentUserId) && record.read[note.id] === undefined) { record.read[note.id] = date; changed = true }
  }
  if (complete) {
    for (const id of Object.keys(record.known)) if (!observed.has(id)) { delete record.known[id]; changed = true }
  }
  if (!changed) return
  record.known = timestamps(record.known)
  record.read = timestamps(record.read)
  delete data.reading[refKey]
  data.reading[refKey] = record
  const entries = Object.entries(data.reading)
  let markers = entries.reduce((count, [, item]) => count + Object.keys(item.known).length + Object.keys(item.read).length, 0)
  while (entries.length > 200 || markers > 16_000) {
    const [, removed] = entries.shift()!
    markers -= Object.keys(removed.known).length + Object.keys(removed.read).length
  }
  data.reading = Object.fromEntries(entries)
  save(scope, data)
}
export function unreadComments(scope: PreferenceScope, ref: MrRef, notes: Note[], currentUserId: string): string[] {
  return unreadIn(readWorkspaceSnapshot(scope), ref, notes, currentUserId)
}
function unreadIn(data: WorkspaceData, ref: MrRef, notes: Note[], currentUserId: string): string[] {
  const record = data.reading[mrRefKey(ref)]
  return notes.filter((note) => !note.system && note.author.id !== currentUserId && record?.read[note.id] === undefined).map((note) => note.id)
}
/** Whether this device has shown the MR before: it is among the recent MRs or has an open tab, which only showing it adds. */
export function hasViewedMergeRequest(scope: PreferenceScope, ref: MrRef): boolean {
  const data = readWorkspaceSnapshot(scope)
  const refKey = mrRefKey(ref)
  return [...data.recent, ...data.open].some((item) => mrRefKey(item) === refKey)
}
/**
 * Whether an MR event is unread: newer than when events started being followed, and then a
 * comment not read where the MR list counts unread comments, any other event newer than the MR's read time.
 */
function activityUnreadIn(data: WorkspaceData, ref: MrRef, createdAt: string, commentId: string | null): boolean {
  if (!data.activitySince) return false
  const created = Date.parse(createdAt)
  if (created <= Date.parse(data.activitySince)) return false
  if (commentId !== null) return data.reading[mrRefKey(ref)]?.read[commentId] === undefined
  return !(created <= Date.parse(data.activityRead[mrRefKey(ref)] ?? ''))
}
/** Starts following MR events from `now`, once. */
export function startActivity(scope: PreferenceScope, now = Date.now()) {
  const data = readWorkspace(scope)
  if (data.activitySince) return
  data.activitySince = new Date(now).toISOString()
  save(scope, data)
}
/** Reads the MR's events up to `until`; an earlier time than the recorded one changes nothing. */
export function markActivityRead(scope: PreferenceScope, ref: MrRef, until: string) {
  if (!validRef(ref) || !Number.isFinite(Date.parse(until))) return
  const data = readWorkspace(scope)
  const refKey = mrRefKey(ref)
  if (Date.parse(until) <= Date.parse(data.activityRead[refKey] ?? '')) return
  delete data.activityRead[refKey]
  data.activityRead[refKey] = until
  data.activityRead = Object.fromEntries(Object.entries(data.activityRead).slice(-200))
  save(scope, data)
}
export function workspaceUnreadCount(scope: PreferenceScope, ref: MrRef): number | undefined {
  return unreadCountIn(readWorkspaceSnapshot(scope), ref)
}
function unreadCountIn(data: WorkspaceData, ref: MrRef): number | undefined {
  const record = data.reading[mrRefKey(ref)]
  return record ? Object.keys(record.known).filter((id) => record.read[id] === undefined).length : undefined
}
/**
 * Adds the MR as the newest open tab unless it already has a tab; existing tabs keep their place.
 * An open tab records that it was shown, which keeps it from closing as stale.
 */
export function openWorkspaceTab(scope: PreferenceScope, ref: MrRef, now = Date.now()) {
  if (!validRef(ref)) return
  const current = readWorkspace(scope)
  const refKey = mrRefKey(ref)
  if (current.pinned.some((item) => mrRefKey(item) === refKey)) return
  if (current.open.some((item) => mrRefKey(item) === refKey)) {
    const last = Date.parse(current.shown[refKey] ?? '')
    if (now - last < SHOWN_RESOLUTION_MS) return
  } else {
    current.open = [{ iid: ref.iid, projectId: ref.projectId }, ...current.open].slice(0, MAX_OPEN_TABS)
  }
  current.shown[refKey] = new Date(now).toISOString()
  save(scope, current)
}

/**
 * Closes the open tabs not shown for `STALE_TAB_MS`, except `current` (the MR on screen).
 * A tab without a recorded time, such as one opened before times were kept, starts counting now.
 */
export function closeStaleTabs(scope: PreferenceScope, current: MrRef | null, now = Date.now()) {
  const data = readWorkspace(scope)
  const currentKey = current ? mrRefKey(current) : null
  let changed = false
  data.open = data.open.filter((ref) => {
    const refKey = mrRefKey(ref)
    const shown = Date.parse(data.shown[refKey] ?? '')
    if (refKey === currentKey) return true
    if (!Number.isFinite(shown)) { data.shown[refKey] = new Date(now).toISOString(); changed = true; return true }
    if (now - shown < STALE_TAB_MS) return true
    changed = true
    return false
  })
  if (changed) save(scope, data)
}
function subscribe(listener: () => void) {
  globalThis.addEventListener(changedEvent, listener)
  globalThis.addEventListener('storage', listener)
  return () => { globalThis.removeEventListener(changedEvent, listener); globalThis.removeEventListener('storage', listener) }
}
/**
 * With `watch`, the caller renders again only when the text `watch` derives from the stored workspace
 * changes, not on every write (a recent MR, another MR's read markers); what it reads outside `watch`
 * may then be as old as that render.
 */
export function usePersonalWorkspace(session: GitLabSession | null, watch?: (data: WorkspaceData) => string) {
  const instanceUrl = session?.instanceUrl ?? 'anonymous'
  const userId = session?.user.id ?? 'anonymous'
  const connected = Boolean(session)
  const version = useSyncExternalStore(subscribe, () => watch ? watch(readWorkspaceSnapshot({ instanceUrl, userId })) : storedWorkspace({ instanceUrl, userId }), () => '')
  // The same object until the stored workspace (or what `watch` reads) changes, so effects that use it do not rerun on every render.
  // Rows of long lists ask for unread counts, so they share this one parsed copy.
  return useMemo(() => workspaceApi({ instanceUrl, userId }, connected, readWorkspaceSnapshot({ instanceUrl, userId }), version), [connected, instanceUrl, userId, version])
}

function workspaceApi(scope: PreferenceScope, connected: boolean, data: WorkspaceData, version: string) {
  return {
    version, pinned: data.pinned, open: data.open, tabs: data.tabs, recent: data.recent, settings: data.settings,
    unreadIds: (ref: MrRef, notes: Note[]) => unreadIn(data, ref, notes, scope.userId),
    unreadCount: (ref: MrRef) => unreadCountIn(data, ref),
    observe: (ref: MrRef, notes: Note[], complete = false) => { if (connected) observeComments(scope, ref, notes, scope.userId, false, complete) },
    markRead: (ref: MrRef, notes: Note[]) => { if (connected) observeComments(scope, ref, notes, scope.userId, true) },
    isActivityUnread: (ref: MrRef, createdAt: string, commentId: string | null) => activityUnreadIn(data, ref, createdAt, commentId),
    startActivity: () => { if (connected) startActivity(scope) },
    markActivityRead: (ref: MrRef, until: string) => { if (connected) markActivityRead(scope, ref, until) },
    isPinned: (ref: MrRef) => data.pinned.some((item) => mrRefKey(item) === mrRefKey(ref)),
    /** Pinning moves an open tab into the pinned tabs. `meta` names the tab when the MR has not been opened. */
    togglePinned: (ref: MrRef, meta?: TabMeta) => {
      if (!connected || !validRef(ref)) return
      const current = readWorkspace(scope)
      const pinned = current.pinned.some((item) => mrRefKey(item) === mrRefKey(ref))
      current.pinned = pinned ? current.pinned.filter((item) => mrRefKey(item) !== mrRefKey(ref)) : [{ iid: ref.iid, projectId: ref.projectId }, ...current.pinned].slice(0, 100)
      if (!pinned) current.open = current.open.filter((item) => mrRefKey(item) !== mrRefKey(ref))
      if (meta) current.tabs[mrRefKey(ref)] = meta
      save(scope, current)
    },
    /** Unpins from the sidebar: the MR stays as the newest open tab, as in Arc. */
    unpinToOpen: (ref: MrRef) => {
      if (!connected || !validRef(ref)) return
      const current = readWorkspace(scope)
      current.pinned = current.pinned.filter((item) => mrRefKey(item) !== mrRefKey(ref))
      current.open = [{ iid: ref.iid, projectId: ref.projectId }, ...current.open.filter((item) => mrRefKey(item) !== mrRefKey(ref))].slice(0, MAX_OPEN_TABS)
      current.shown[mrRefKey(ref)] = new Date().toISOString()
      save(scope, current)
    },
    /** Moves a tab within its own section, pinned or open. */
    moveTab: (ref: MrRef, toIndex: number) => {
      if (!connected) return
      const current = readWorkspace(scope)
      const section = current.pinned.some((item) => mrRefKey(item) === mrRefKey(ref)) ? 'pinned' : 'open'
      const items = current[section].filter((item) => mrRefKey(item) !== mrRefKey(ref))
      if (items.length === current[section].length) return
      items.splice(Math.max(0, Math.min(items.length, toIndex)), 0, { iid: ref.iid, projectId: ref.projectId })
      current[section] = items
      save(scope, current)
    },
    closeTab: (ref: MrRef) => {
      if (!connected) return
      const current = readWorkspace(scope)
      current.open = current.open.filter((item) => mrRefKey(item) !== mrRefKey(ref))
      save(scope, current)
    },
    closeAllTabs: () => {
      if (!connected) return
      const current = readWorkspace(scope)
      current.open = []
      save(scope, current)
    },
    rememberTab: (ref: MrRef, meta: TabMeta) => {
      if (!connected || !validRef(ref)) return
      const current = readWorkspace(scope)
      const previous = current.tabs[mrRefKey(ref)]
      if (previous && previous.title === meta.title && previous.state === meta.state && previous.projectPath === meta.projectPath) return
      current.tabs[mrRefKey(ref)] = meta
      save(scope, current)
    },
    recordRecent: (ref: MrRef) => {
      if (!connected || !validRef(ref)) return
      const current = readWorkspace(scope)
      current.recent = [ref, ...current.recent.filter((item) => mrRefKey(item) !== mrRefKey(ref))].slice(0, 30)
      save(scope, current)
    },
    setSettings: (settings: Partial<WorkspaceSettings>) => {
      if (!connected) return
      const current = readWorkspace(scope)
      current.settings = { ...current.settings, ...settings }
      save(scope, current)
    },
  }
}
