import { useSyncExternalStore } from 'react'
import type { GitLabSession, Note } from '../../types/gitlab'
import { scopedKey, type PreferenceScope } from './preferences'

export interface MrRef { projectId: string; iid: string }
export interface WorkspaceSettings {
  autoRefresh: boolean
  notifyComments: boolean
  notifyTodos: boolean
}
interface Reading { known: Record<string, string>; read: Record<string, string> }
interface WorkspaceData {
  pinned: MrRef[]
  recent: MrRef[]
  reading: Record<string, Reading>
  settings: WorkspaceSettings
}
export const defaultWorkspaceSettings: WorkspaceSettings = { autoRefresh: true, notifyComments: false, notifyTodos: false }
const changedEvent = 'gitlab-workspace-preferences-change'
export function mrRefKey(ref: MrRef): string { return `${ref.projectId}:${ref.iid}` }
const emptyData = (): WorkspaceData => ({ pinned: [], recent: [], reading: {}, settings: { ...defaultWorkspaceSettings } })
const validRef = (ref: unknown): ref is MrRef => Boolean(ref && typeof ref === 'object' && /^[1-9]\d*$/u.test((ref as MrRef).projectId) && /^[1-9]\d*$/u.test((ref as MrRef).iid))
function refs(value: unknown, max: number): MrRef[] {
  return Array.isArray(value) ? value.filter(validRef).filter((ref, index, all) => all.findIndex((other) => mrRefKey(other) === mrRefKey(ref)) === index).slice(0, max) : []
}
function timestamps(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {}
  return Object.fromEntries(Object.entries(value).filter(([id, date]) => /^[1-9]\d*$/u.test(id) && typeof date === 'string' && Number.isFinite(Date.parse(date))).slice(-2000))
}
function key(scope: PreferenceScope) { return scopedKey(scope, 'personal-workspace') }
export function readWorkspace(scope: PreferenceScope): WorkspaceData {
  try {
    const raw = localStorage.getItem(key(scope))
    if (!raw) return emptyData()
    const value = JSON.parse(raw) as Partial<WorkspaceData>
    const reading: Record<string, Reading> = {}
    if (value.reading && typeof value.reading === 'object') {
      for (const [ref, record] of Object.entries(value.reading).slice(-200)) {
        if (/^[1-9]\d*:[1-9]\d*$/u.test(ref) && record && typeof record === 'object') reading[ref] = { known: timestamps(record.known), read: timestamps(record.read) }
      }
    }
    return { pinned: refs(value.pinned, 100), recent: refs(value.recent, 30), reading, settings: {
      autoRefresh: value.settings?.autoRefresh !== false,
      notifyComments: value.settings?.notifyComments === true,
      notifyTodos: value.settings?.notifyTodos === true,
    } }
  } catch { return emptyData() }
}
function save(scope: PreferenceScope, data: WorkspaceData) {
  const text = JSON.stringify(data)
  try {
    if (localStorage.getItem(key(scope)) === text) return
    localStorage.setItem(key(scope), text)
    globalThis.dispatchEvent(new Event(changedEvent))
  } catch { /* Reading markers and shortcuts remain optional. */ }
}
function stamp(note: Note) { return note.updatedAt || note.createdAt }
export function observeComments(scope: PreferenceScope, ref: MrRef, notes: Note[], currentUserId: string, markRead = false) {
  if (!validRef(ref)) return
  const data = readWorkspace(scope)
  const refKey = mrRefKey(ref)
  const record = data.reading[refKey] ?? { known: {}, read: {} }
  let changed = false
  for (const note of notes) {
    if (note.system || !/^[1-9]\d*$/u.test(note.id) || !Number.isFinite(Date.parse(stamp(note)))) continue
    const date = stamp(note)
    if (record.known[note.id] !== date) { record.known[note.id] = date; changed = true }
    if ((markRead || note.author.id === currentUserId) && record.read[note.id] !== date) { record.read[note.id] = date; changed = true }
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
  const record = readWorkspace(scope).reading[mrRefKey(ref)]
  return notes.filter((note) => !note.system && note.author.id !== currentUserId && record?.read[note.id] !== stamp(note)).map((note) => note.id)
}
export function workspaceUnreadCount(scope: PreferenceScope, ref: MrRef): number | undefined {
  const record = readWorkspace(scope).reading[mrRefKey(ref)]
  return record ? Object.entries(record.known).filter(([id, date]) => record.read[id] !== date).length : undefined
}
function subscribe(listener: () => void) {
  globalThis.addEventListener(changedEvent, listener)
  globalThis.addEventListener('storage', listener)
  return () => { globalThis.removeEventListener(changedEvent, listener); globalThis.removeEventListener('storage', listener) }
}
export function usePersonalWorkspace(session: GitLabSession | null) {
  const scope = { instanceUrl: session?.instanceUrl ?? 'anonymous', userId: session?.user.id ?? 'anonymous' }
  const getSnapshot = () => { try { return localStorage.getItem(key(scope)) ?? '' } catch { return '' } }
  const version = useSyncExternalStore(subscribe, getSnapshot, () => '')
  const data = readWorkspace(scope)
  return {
    version, pinned: data.pinned, recent: data.recent, settings: data.settings,
    unreadIds: (ref: MrRef, notes: Note[]) => unreadComments(scope, ref, notes, scope.userId),
    unreadCount: (ref: MrRef) => workspaceUnreadCount(scope, ref),
    observe: (ref: MrRef, notes: Note[]) => { if (session) observeComments(scope, ref, notes, scope.userId) },
    markRead: (ref: MrRef, notes: Note[]) => { if (session) observeComments(scope, ref, notes, scope.userId, true) },
    isPinned: (ref: MrRef) => data.pinned.some((item) => mrRefKey(item) === mrRefKey(ref)),
    togglePinned: (ref: MrRef) => {
      if (!session || !validRef(ref)) return
      const current = readWorkspace(scope)
      current.pinned = current.pinned.some((item) => mrRefKey(item) === mrRefKey(ref)) ? current.pinned.filter((item) => mrRefKey(item) !== mrRefKey(ref)) : [ref, ...current.pinned].slice(0, 100)
      save(scope, current)
    },
    recordRecent: (ref: MrRef) => {
      if (!session || !validRef(ref)) return
      const current = readWorkspace(scope)
      current.recent = [ref, ...current.recent.filter((item) => mrRefKey(item) !== mrRefKey(ref))].slice(0, 30)
      save(scope, current)
    },
    setSettings: (settings: Partial<WorkspaceSettings>) => {
      if (!session) return
      const current = readWorkspace(scope)
      current.settings = { ...current.settings, ...settings }
      save(scope, current)
    },
  }
}
