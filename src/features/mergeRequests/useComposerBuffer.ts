import { useCallback, useEffect, useState } from 'react'

import type { GitLabSession, Position } from '../../types/gitlab'
import { useAutoUpdateSafety } from '../shared/AutoUpdateSafety'

const MAX_COMPOSER_BUFFERS = 100
const MAX_COMPOSER_BODY_LENGTH = 64 * 1024

interface BufferEntry {
  body: string
  setUnsafe?: (unsafe: boolean) => void
}

const composerBuffers = new Map<string, BufferEntry>()

export function createComposerBufferKey(
  session: GitLabSession | null,
  projectId: string,
  iid: string,
  replyId: string,
  position?: Position,
): string {
  return JSON.stringify({
    account: { instanceUrl: session?.instanceUrl ?? '', userId: session?.user.id ?? '' },
    iid,
    position: position ? {
      baseSha: position.baseSha,
      headSha: position.headSha,
      newLine: position.newLine ?? null,
      newPath: position.newPath,
      oldLine: position.oldLine ?? null,
      oldPath: position.oldPath,
      positionType: position.positionType,
      startSha: position.startSha,
    } : null,
    projectId,
    replyId,
    sessionId: session?.id ?? '',
  })
}

/** Clear all private in-memory review text when a session is disposed. */
export function clearComposerBufferStore(): void {
  for (const entry of composerBuffers.values()) entry.setUnsafe?.(false)
  composerBuffers.clear()
}

export function useComposerBuffer(bufferKey: string) {
  const [body, setBody] = useState(() => composerBuffers.get(bufferKey)?.body ?? '')
  const [error, setError] = useState<string | null>(null)
  const { setUnsafe } = useAutoUpdateSafety(`composer:${bufferKey}`, { persistOnUnmount: true })

  useEffect(() => {
    const entry = composerBuffers.get(bufferKey)
    if (entry) {
      entry.setUnsafe = setUnsafe
      setUnsafe(Boolean(entry.body))
    } else {
      setUnsafe(false)
    }
    return () => {
      const retained = composerBuffers.get(bufferKey)
      if (retained) retained.setUnsafe = setUnsafe
    }
  }, [bufferKey, setUnsafe])

  const change = useCallback((nextBody: string): boolean => {
    if (new TextEncoder().encode(nextBody).byteLength > MAX_COMPOSER_BODY_LENGTH) {
      setError('コメントは64 KiB以内で入力してください。超過した内容は保存されていません。')
      return false
    }
    if (!nextBody) {
      composerBuffers.delete(bufferKey)
      setBody('')
      setError(null)
      setUnsafe(false)
      return true
    }
    if (!composerBuffers.has(bufferKey) && composerBuffers.size >= MAX_COMPOSER_BUFFERS) {
      setError('未送信コメントは100件まで保持できます。既存の入力を送信または破棄してください。')
      return false
    }
    composerBuffers.set(bufferKey, { body: nextBody, setUnsafe })
    setBody(nextBody)
    setError(null)
    setUnsafe(true)
    return true
  }, [bufferKey, setUnsafe])

  const discard = useCallback(() => {
    composerBuffers.delete(bufferKey)
    setBody('')
    setError(null)
    setUnsafe(false)
  }, [bufferKey, setUnsafe])

  return { body, change, discard, error }
}
