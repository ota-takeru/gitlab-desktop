import { useLayoutEffect, useRef, type KeyboardEvent, type RefObject } from 'react'

import { formatMarkdown, type MarkdownFormat } from '../../lib/markdownFormat'

/**
 * Replaces `textarea.value[start, end)` with `text` through the browser's text insertion, so Ctrl+Z undoes it.
 * False when the browser did not make that edit; the caller then sets the value itself.
 */
export function insertTextareaText(textarea: HTMLTextAreaElement, start: number, end: number, text: string): boolean {
  const nextValue = `${textarea.value.slice(0, start)}${text}${textarea.value.slice(end)}`
  textarea.focus()
  textarea.setSelectionRange(start, end)
  let inserted: boolean
  try {
    inserted = typeof document.execCommand === 'function' && document.execCommand('insertText', false, text)
  } catch {
    inserted = false
  }
  return inserted && textarea.value === nextValue
}

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
    if (!insertTextareaText(textarea, edit.start, edit.end, edit.text)) {
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
