import { useMemo, useState } from 'react'

import type { Diff } from '../../types/gitlab'
import { scopedKey, type PreferenceScope } from '../shared/preferences'

export interface ReviewedFileContext extends PreferenceScope {
  projectId: string
  mergeRequestIid: string
  /** Current MR head SHA. A changed head makes every prior check stale. */
  revision: string
}

const STORAGE_NAME = 'reviewed-files'
const MAX_MERGE_REQUESTS = 100
const MAX_FILES_PER_MERGE_REQUEST = 500

type StoredReviewState = Record<string, Record<string, string>>

/**
 * Tracks file checks separately for each account and MR. The fingerprint
 * includes the current revision and diff text, so a changed head or file diff
 * automatically returns that file to the unreviewed state.
 */
export function useReviewedFiles(context: ReviewedFileContext | undefined, diffs: Diff[]) {
  const key = context ? scopedKey(context, STORAGE_NAME) : null
  const mergeRequestKey = context ? `${context.projectId}:${context.mergeRequestIid}` : null
  const revision = context?.revision ?? ''
  const identity = `${key ?? ''}\0${mergeRequestKey ?? ''}`
  const [snapshot, setSnapshot] = useState<{ identity: string; files: Record<string, string> }>(() => ({
    identity,
    files: key && mergeRequestKey ? readState(key)[mergeRequestKey] ?? {} : {},
  }))
  const files = useMemo(() => snapshot.identity === identity
    ? snapshot.files
    : key && mergeRequestKey ? readState(key)[mergeRequestKey] ?? {} : {}, [identity, key, mergeRequestKey, snapshot])
  const reviewedPaths = useMemo(() => {
    if (!revision) return new Set<string>()
    return new Set(diffs
      .filter((diff) => {
        const path = diff.newPath || diff.oldPath
        return files[path] === diffFingerprint(revision, diff.diff)
      })
      .map((diff) => diff.newPath || diff.oldPath))
  }, [diffs, files, revision])

  const toggleReviewed = (diff: Diff) => {
    if (!context || !key || !mergeRequestKey || !revision) return
    const path = diff.newPath || diff.oldPath
    const nextFiles = setFileReviewed(context, diff, files[path] !== diffFingerprint(revision, diff.diff))
    setSnapshot({ identity, files: nextFiles })
  }

  return {
    enabled: Boolean(key && mergeRequestKey && revision),
    isReviewed: (path: string) => reviewedPaths.has(path),
    reviewedPaths,
    toggleReviewed,
  }
}

export function setFileReviewed(context: ReviewedFileContext, diff: Diff, reviewed: boolean): Record<string, string> {
  if (!context.revision) return {}
  const key = scopedKey(context, STORAGE_NAME)
  const mergeRequestKey = `${context.projectId}:${context.mergeRequestIid}`
  const path = diff.newPath || diff.oldPath
  const state = readState(key)
  const files = { ...(state[mergeRequestKey] ?? {}) }
  if (reviewed) {
    files[path] = diffFingerprint(context.revision, diff.diff)
    trimObject(files, MAX_FILES_PER_MERGE_REQUEST)
  } else {
    delete files[path]
  }
  delete state[mergeRequestKey]
  if (Object.keys(files).length > 0) state[mergeRequestKey] = files
  trimObject(state, MAX_MERGE_REQUESTS)
  writeState(key, state)
  return files
}

function diffFingerprint(revision: string, diff: string): string {
  // Two independent 32-bit hashes plus the input length keep local storage
  // compact while making accidental collisions very unlikely.
  const value = `${revision}\0${diff}`
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    first = Math.imul(first ^ code, 0x01000193)
    second = Math.imul(second ^ code, 0x85ebca6b)
  }
  return `${value.length}:${(first >>> 0).toString(36)}:${(second >>> 0).toString(36)}`
}

function readState(key: string): StoredReviewState {
  try {
    const parsed: unknown = JSON.parse(globalThis.localStorage?.getItem(key) ?? 'null')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const state: StoredReviewState = {}
    for (const [mergeRequestKey, candidateFiles] of Object.entries(parsed).slice(-MAX_MERGE_REQUESTS)) {
      if (!candidateFiles || typeof candidateFiles !== 'object' || Array.isArray(candidateFiles)) continue
      const files = Object.entries(candidateFiles as Record<string, unknown>)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        .slice(-MAX_FILES_PER_MERGE_REQUEST)
      if (files.length) state[mergeRequestKey] = Object.fromEntries(files)
    }
    return state
  } catch {
    return {}
  }
}

function writeState(key: string, value: StoredReviewState): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value))
  } catch {
    // Review marks are optional and must not block reading a diff.
  }
}

function trimObject<T>(value: Record<string, T>, limit: number): void {
  const keys = Object.keys(value)
  for (const key of keys.slice(0, Math.max(0, keys.length - limit))) delete value[key]
}
