import { useEffect, type RefObject } from 'react'

/** Puts the focus in this screen's search field when the search shortcuts (Ctrl+K, /) ask for it. */
export function useFocusSearchShortcut(inputRef: RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const focus = () => inputRef.current?.focus()
    globalThis.addEventListener('gitlab-focus-project-search', focus)
    return () => globalThis.removeEventListener('gitlab-focus-project-search', focus)
  }, [inputRef])
}
