import Box from '@mui/material/Box'
import { startTransition, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import type { ThreadRevealQueue } from './threadRevealQueue'

/**
 * A thread's contents, or until its turn a box of about its height. The box answers to the
 * thread's first comment, so moving to the thread (N / P, the outline) finds it, and taking
 * the focus there mounts the thread at once and hands the focus to the comment.
 */
export function DeferredThread({ children, estimatedHeight, firstNoteId, queue, wait }: {
  children: ReactNode
  estimatedHeight: number
  firstNoteId?: string
  queue: ThreadRevealQueue
  wait: boolean
}) {
  const [shown, setShown] = useState(!wait)
  if (!wait && !shown) setShown(true)
  const placeholder = useRef<HTMLDivElement | null>(null)
  const focusIn = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const element = placeholder.current
    if (shown || !element) return
    return queue.add(element, () => startTransition(() => setShown(true)))
  }, [queue, shown])
  useLayoutEffect(() => {
    if (!shown || !focusIn.current) return
    focusIn.current.querySelector<HTMLElement>('[data-note-id]')?.focus({ preventScroll: true })
    focusIn.current = null
  }, [shown])
  if (shown) return children
  return <Box
    aria-busy
    data-note-id={firstNoteId}
    onFocus={(event) => {
      focusIn.current = event.currentTarget.parentElement
      setShown(true)
    }}
    ref={placeholder}
    style={{ height: estimatedHeight }}
    tabIndex={-1}
  />
}
