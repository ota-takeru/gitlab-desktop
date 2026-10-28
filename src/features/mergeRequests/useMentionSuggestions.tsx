import Popper, { type PopperProps } from '@mui/material/Popper'
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode, type Ref, type RefObject } from 'react'

import type { MarkdownEditorHandle, MarkdownEditorKeyEvent } from '../../components/MarkdownEditor'
import type { GitLabUser } from '../../types/gitlab'
import { MentionSuggestions } from './MentionSuggestions'

/**
 * `@` mention candidates for a MarkdownEditor: spread `editorProps` on it, run
 * `handleKeyDown` first in its onKeyDown, attach `containerRef` to the element
 * around it and render `popup`.
 */
export function useMentionSuggestions({ disabled = false, editorRef, enabled, participants = EMPTY_USERS }: {
  disabled?: boolean
  editorRef: RefObject<MarkdownEditorHandle | null>
  enabled: boolean
  /** People of the MR, offered as soon as `@` is typed and ahead of other users. */
  participants?: GitLabUser[]
}): {
  containerRef: (element: HTMLElement | null) => void
  editorProps: { activeDescendantId: string | null; controlsId: string | null; onMentionQueryChange?: (query: string | null) => void }
  handleKeyDown: (event: MarkdownEditorKeyEvent) => boolean
  popup: ReactNode
} {
  const [query, setQuery] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<GitLabUser[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const listId = useId()
  const containerRef = useRef<HTMLElement | null>(null)
  const setContainer = useCallback((element: HTMLElement | null) => { containerRef.current = element }, [])
  const popperRef = useRef<PopperInstance | null>(null)
  // The candidates follow the `@` being typed; the container's scroll parents move them too.
  const anchor = useMemo(() => ({
    getBoundingClientRect: () => editorRef.current?.mentionAnchorRect() ?? new DOMRect(),
    get contextElement() { return containerRef.current ?? undefined },
  }), [editorRef])
  const shown = enabled && query !== null
  const listShown = shown && candidates.length > 0 && !disabled

  useEffect(() => {
    popperRef.current?.update()
  }, [query])

  const onCandidatesChange = useCallback((users: GitLabUser[]) => {
    setCandidates(users)
    setActiveIndex(0)
  }, [])

  const close = () => {
    setQuery(null)
    setCandidates([])
  }
  const insert = (user: GitLabUser) => {
    editorRef.current?.insertMention(`@${user.username}`)
    close()
  }

  const handleKeyDown = (event: MarkdownEditorKeyEvent) => {
    if (!shown) return false
    if (candidates.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActiveIndex((current) => (current + 1) % candidates.length)
        return true
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveIndex((current) => (current - 1 + candidates.length) % candidates.length)
        return true
      }
      if (event.key === 'Enter' && !event.ctrlKey && !event.shiftKey) {
        event.preventDefault()
        insert(candidates[activeIndex] ?? candidates[0])
        return true
      }
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return true
    }
    return false
  }

  return {
    containerRef: setContainer,
    editorProps: {
      activeDescendantId: listShown ? mentionOptionId(listId, activeIndex) : null,
      controlsId: listShown ? listId : null,
      onMentionQueryChange: enabled ? (next) => { setQuery(next); setActiveIndex(0) } : undefined,
    },
    handleKeyDown,
    popup: (
      <Popper anchorEl={anchor} modifiers={[{ name: 'offset', options: { offset: [0, 4] } }]} open={shown && !disabled} placement="bottom-start" popperRef={popperRef} sx={{ zIndex: 'modal' }}>
        <MentionSuggestions id={listId} onSelect={insert} onUsersChange={onCandidatesChange} optionId={(index) => mentionOptionId(listId, index)} participants={participants} search={query ?? ''} selectedIndex={activeIndex} />
      </Popper>
    ),
  }
}

function mentionOptionId(listId: string, index: number): string {
  return `${listId}-option-${index}`
}

const EMPTY_USERS: GitLabUser[] = []

type PopperInstance = PopperProps['popperRef'] extends Ref<infer Instance> | undefined ? Instance : never
