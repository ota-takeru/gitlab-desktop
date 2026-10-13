import { useLayoutEffect, useRef, type KeyboardEvent, type RefObject } from 'react'

import { formatMarkdown, type MarkdownFormat } from '../../lib/markdownFormat'

/**
 * Applies Markdown toolbar formats to a controlled textarea. Edits go through
 * the browser's text insertion when available so Ctrl+Z still undoes them.
 */
export function useMarkdownFormatting(inputRef: RefObject<HTMLTextAreaElement | null>, value: string, onChange: (value: string) => void) {
  const pendingSelectionRef = useRef<[number, number] | null>(null)

  useLayoutEffect(() => {
    const selection = pendingSelectionRef.current
    if (!selection || !inputRef.current) return
    inputRef.current.setSelectionRange(...selection)
    pendingSelectionRef.current = null
  }, [inputRef, value])

  const applyFormat = (format: MarkdownFormat) => {
    const textarea = inputRef.current
    if (!textarea || textarea.disabled) return
    const edit = formatMarkdown(textarea.value, textarea.selectionStart, textarea.selectionEnd, format)
    const nextValue = `${textarea.value.slice(0, edit.start)}${edit.text}${textarea.value.slice(edit.end)}`
    textarea.focus()
    textarea.setSelectionRange(edit.start, edit.end)
    let inserted: boolean
    try {
      inserted = typeof document.execCommand === 'function' && document.execCommand('insertText', false, edit.text)
    } catch {
      inserted = false
    }
    if (!inserted || textarea.value !== nextValue) {
      pendingSelectionRef.current = [edit.selectionStart, edit.selectionEnd]
      onChange(nextValue)
    }
    textarea.setSelectionRange(edit.selectionStart, edit.selectionEnd)
  }

  /** Handles Ctrl+B / Ctrl+I / Ctrl+Shift+X; returns true when the key was used. */
  const handleFormatShortcut = (event: KeyboardEvent) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return false
    const key = event.key.toLowerCase()
    const format: MarkdownFormat | null = !event.shiftKey && key === 'b' ? 'bold'
      : !event.shiftKey && key === 'i' ? 'italic'
        : event.shiftKey && key === 'x' ? 'strikethrough'
          : null
    if (!format) return false
    event.preventDefault()
    applyFormat(format)
    return true
  }

  return { applyFormat, handleFormatShortcut }
}
