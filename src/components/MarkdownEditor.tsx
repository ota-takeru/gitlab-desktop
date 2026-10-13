import Box from '@mui/material/Box'
import InputBase from '@mui/material/InputBase'
import Stack from '@mui/material/Stack'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import type { Editor } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from 'react'

import { applyRichFormat, canEditAsRichText, createRichMarkdownExtensions, getEditorMarkdown } from '../lib/richMarkdown'
import { useMarkdownFormatting } from '../features/shared/useMarkdownFormatting'
import { MarkdownToolbar } from './MarkdownToolbar'
import { markdownBodySx } from './markdownBodySx'

export type MarkdownEditorMode = 'rich' | 'source'
export const MARKDOWN_EDITOR_MODE_KEY = 'gitlab-desktop.markdownEditorMode'

export interface MarkdownEditorKeyEvent {
  altKey: boolean
  ctrlKey: boolean
  key: string
  metaKey: boolean
  shiftKey: boolean
  preventDefault: () => void
}

export interface MarkdownEditorHandle {
  focus: () => void
  /** Inserts Markdown such as an attachment link on its own line at the caret. */
  insertBlock: (markdown: string) => void
  /** Replaces the `@query` last reported through onMentionQueryChange. */
  insertMention: (text: string) => void
}

interface MarkdownEditorProps {
  autoFocus?: boolean
  disabled?: boolean
  label: string
  placeholder?: string
  ref?: Ref<MarkdownEditorHandle>
  /** Extra toolbar controls, such as attaching a file. */
  toolbarEnd?: ReactNode
  value: string
  onChange: (value: string) => void
  /** Runs before the editor's own key handling; return true when the key was used. */
  onKeyDown?: (event: MarkdownEditorKeyEvent) => boolean
  /** Reports the `@query` (two or more characters) at the caret, or null. */
  onMentionQueryChange?: (query: string | null) => void
  onPasteImage?: (file: File) => void
}

/**
 * Markdown input that formats in place (rich) or shows the Markdown source.
 * Bodies the rich editor cannot keep intact, such as raw HTML, open as source.
 */
export function MarkdownEditor({ ref, toolbarEnd, ...inputProps }: MarkdownEditorProps) {
  const { disabled = false, label, value } = inputProps
  const [preferredMode, setPreferredMode] = useState<MarkdownEditorMode>(readMode)
  const [richBlocked, setRichBlocked] = useState(() => preferredMode === 'rich' && !canEditAsRichText(value))
  const mode: MarkdownEditorMode = preferredMode === 'rich' && !richBlocked ? 'rich' : 'source'
  const richRef = useRef<Editor | null>(null)
  const sourceRef = useRef<SourceInputHandle | null>(null)

  const changeMode = (next: MarkdownEditorMode) => {
    if (next === 'rich' && !canEditAsRichText(value)) {
      setRichBlocked(true)
      return
    }
    setRichBlocked(false)
    setPreferredMode(next)
    writeMode(next)
  }

  return (
    <Box sx={{ bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: 1, minWidth: 0, '&:focus-within': { borderColor: 'primary.main' } }}>
      <Stack direction="row" sx={{ alignItems: 'center', borderBottom: 1, borderColor: 'divider', columnGap: 0.5, flexWrap: 'wrap', px: 0.5, py: 0.25 }}>
        <MarkdownToolbar
          disabled={disabled}
          onFormat={(format) => {
            if (mode === 'rich' && richRef.current) applyRichFormat(richRef.current, format)
            else sourceRef.current?.applyFormat(format)
          }}
        />
        {toolbarEnd}
        <ToggleButtonGroup
          aria-label="入力方式"
          disabled={disabled}
          exclusive
          onChange={(_, next: MarkdownEditorMode | null) => { if (next) changeMode(next) }}
          size="small"
          sx={{ ml: 'auto' }}
          value={mode}
        >
          <ToggleButton sx={{ px: 1, py: 0.25 }} title="書式をその場で表示して編集" value="rich">リッチ</ToggleButton>
          <ToggleButton sx={{ px: 1, py: 0.25 }} title="Markdownの記法をそのまま編集" value="source">Markdown</ToggleButton>
        </ToggleButtonGroup>
      </Stack>
      {mode === 'rich'
        ? <RichInput {...inputProps} editorRef={richRef} handleRef={ref} onUnsupported={() => setRichBlocked(true)} />
        : <SourceInput {...inputProps} handleRef={ref} inputHandleRef={sourceRef} />}
      {richBlocked && preferredMode === 'rich' ? (
        <Typography color="text.secondary" component="p" sx={{ borderTop: 1, borderColor: 'divider', px: 1.25, py: 0.5 }} variant="caption">
          HTMLなどリッチ表示で保持できない記法を含むため、{label}をMarkdownのまま編集しています。
        </Typography>
      ) : null}
    </Box>
  )
}

interface InputProps extends Omit<MarkdownEditorProps, 'ref' | 'toolbarEnd'> {
  handleRef?: Ref<MarkdownEditorHandle>
}

function RichInput({ autoFocus, disabled = false, editorRef, handleRef, label, onChange, onKeyDown, onMentionQueryChange, onPasteImage, onUnsupported, placeholder, value }: InputProps & { editorRef: { current: Editor | null }; onUnsupported: () => void }) {
  const lastValueRef = useRef(value)
  const mentionRef = useRef<{ from: number; to: number } | null>(null)
  const callbacksRef = useRef({ onChange, onKeyDown, onMentionQueryChange, onPasteImage })

  useLayoutEffect(() => {
    callbacksRef.current = { onChange, onKeyDown, onMentionQueryChange, onPasteImage }
  }, [onChange, onKeyDown, onMentionQueryChange, onPasteImage])

  const reportMention = (editor: Editor) => {
    const report = callbacksRef.current.onMentionQueryChange
    if (!report) return
    const { $from, empty, from } = editor.state.selection
    const parent = $from.parent
    const mention = empty && parent.isTextblock
      ? findMention(parent.textBetween(0, $from.parentOffset, undefined, '￼'), parent.textBetween($from.parentOffset, parent.content.size, undefined, '￼'))
      : null
    mentionRef.current = mention ? { from: from - mention.before, to: from + mention.after } : null
    report(mention?.query ?? null)
  }

  const editor = useEditor({
    autofocus: autoFocus ? 'end' : false,
    content: value,
    contentType: 'markdown',
    editable: !disabled,
    editorProps: {
      attributes: { 'aria-label': label, 'aria-multiline': 'true', role: 'textbox' },
      handleKeyDown: (_view, event) => {
        if (callbacksRef.current.onKeyDown?.(event)) return true
        // Same strikethrough shortcut as the Markdown input.
        if ((event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'x' && editorRef.current) {
          applyRichFormat(editorRef.current, 'strikethrough')
          return true
        }
        return false
      },
      handlePaste: (_view, event) => {
        const image = event.clipboardData ? imageFromClipboard(event.clipboardData) : null
        const onPaste = callbacksRef.current.onPasteImage
        if (!image || !onPaste) return false
        onPaste(image)
        return true
      },
    },
    extensions: createRichMarkdownExtensions(placeholder),
    onSelectionUpdate: ({ editor: current }) => reportMention(current),
    onUpdate: ({ editor: current }) => {
      const markdown = getEditorMarkdown(current)
      lastValueRef.current = markdown
      callbacksRef.current.onChange(markdown)
      reportMention(current)
    },
    shouldRerenderOnTransaction: false,
  })

  useLayoutEffect(() => {
    editorRef.current = editor
    return () => { editorRef.current = null }
  }, [editor, editorRef])

  useEffect(() => {
    editor.setEditable(!disabled, false)
  }, [disabled, editor])

  useEffect(() => {
    // Follow changes made outside the editor: clearing after submit, restored or appended text.
    if (value === lastValueRef.current) return
    lastValueRef.current = value
    if (!canEditAsRichText(value)) {
      onUnsupported()
      return
    }
    editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false })
  }, [editor, onUnsupported, value])

  useImperativeHandle(handleRef, () => ({
    focus: () => { editor.commands.focus('end') },
    insertBlock: (markdown) => { editor.chain().focus().insertContent(markdown, { contentType: 'markdown' }).run() },
    insertMention: (text) => {
      const range = mentionRef.current
      if (!range) return
      const tail = editor.state.doc.textBetween(range.to, Math.min(range.to + 1, editor.state.selection.$from.end()), undefined, '￼')
      const separator = tail && /^[\s.,!?)]/.test(tail) ? '' : ' '
      editor.chain().focus().insertContentAt(range, { text: `${text}${separator}`, type: 'text' }).run()
    },
  }), [editor])

  return <Box sx={richEditorSx}><EditorContent editor={editor} /></Box>
}

interface SourceInputHandle {
  applyFormat: ReturnType<typeof useMarkdownFormatting>['applyFormat']
}

function SourceInput({ autoFocus, disabled = false, handleRef, inputHandleRef, label, onChange, onKeyDown, onMentionQueryChange, onPasteImage, placeholder, value }: InputProps & { inputHandleRef: { current: SourceInputHandle | null } }) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const valueRef = useRef(value)
  const mentionRef = useRef<{ start: number; end: number } | null>(null)
  const pendingCursorRef = useRef<number | null>(null)
  const updateValue = (next: string) => {
    valueRef.current = next
    onChange(next)
  }
  const { applyFormat, handleFormatShortcut } = useMarkdownFormatting(inputRef, value, updateValue)

  useLayoutEffect(() => {
    valueRef.current = value
    inputHandleRef.current = { applyFormat }
    if (pendingCursorRef.current === null || !inputRef.current) return
    const cursor = pendingCursorRef.current
    inputRef.current.setSelectionRange(cursor, cursor)
    pendingCursorRef.current = null
  })

  const reportMention = () => {
    const textarea = inputRef.current
    if (!onMentionQueryChange || !textarea) return
    const caret = textarea.selectionStart
    const mention = caret === textarea.selectionEnd ? findMention(textarea.value.slice(0, caret), textarea.value.slice(caret)) : null
    mentionRef.current = mention ? { end: caret + mention.after, start: caret - mention.before } : null
    onMentionQueryChange(mention?.query ?? null)
  }

  useImperativeHandle(handleRef, () => ({
    focus: () => { inputRef.current?.focus() },
    insertBlock: (markdown) => {
      const textarea = inputRef.current
      const currentValue = valueRef.current
      const start = textarea?.selectionStart ?? currentValue.length
      const prefix = currentValue.slice(0, start)
      const suffix = currentValue.slice(start)
      const leadingNewline = prefix && !prefix.endsWith('\n') ? '\n' : ''
      const trailingNewline = suffix && !suffix.startsWith('\n') ? '\n' : ''
      pendingCursorRef.current = start + leadingNewline.length + markdown.length
      updateValue(`${prefix}${leadingNewline}${markdown}${trailingNewline}${suffix}`)
      textarea?.focus()
    },
    insertMention: (text) => {
      const range = mentionRef.current
      if (!range) return
      const currentValue = valueRef.current
      const tail = currentValue.slice(range.end)
      const insertion = `${text}${tail && /^[\s.,!?)]/.test(tail) ? '' : ' '}`
      pendingCursorRef.current = range.start + insertion.length
      updateValue(`${currentValue.slice(0, range.start)}${insertion}${tail}`)
      mentionRef.current = null
      inputRef.current?.focus()
    },
  }))

  return (
    <InputBase
      autoFocus={autoFocus}
      disabled={disabled}
      fullWidth
      inputProps={{ 'aria-label': label }}
      inputRef={inputRef}
      maxRows={12}
      minRows={2}
      multiline
      onChange={(event) => {
        updateValue(event.target.value)
        reportMention()
      }}
      onClick={reportMention}
      onKeyDown={(event) => {
        if (onKeyDown?.(event)) return
        handleFormatShortcut(event)
      }}
      onKeyUp={reportMention}
      onPaste={(event) => {
        const image = imageFromClipboard(event.clipboardData)
        if (!image || !onPasteImage) return
        event.preventDefault()
        onPasteImage(image)
      }}
      placeholder={placeholder}
      sx={{ fontFamily: 'typography.code.fontFamily', fontSize: 'body2.fontSize', px: 1.25, py: 1 }}
      value={value}
    />
  )
}

/** Office apps put a rendered image next to copied text; that text is pasted, not the image. */
function imageFromClipboard(data: DataTransfer): File | null {
  if (data.getData('text/plain')) return null
  return Array.from(data.items).find((item) => item.kind === 'file' && item.type.startsWith('image/'))?.getAsFile() ?? null
}

/** The `@query` around the caret; `before`/`after` count its characters on each side of the caret. */
function findMention(beforeCaret: string, afterCaret: string): { after: number; before: number; query: string } | null {
  const match = /(?:^|[\s([{])@([a-zA-Z0-9_.-]*)$/.exec(beforeCaret)
  if (!match) return null
  const trailing = /^[a-zA-Z0-9_.-]*/.exec(afterCaret)?.[0] ?? ''
  const query = `${match[1]}${trailing}`
  return query.length >= 2 ? { after: trailing.length, before: match[1].length + 1, query } : null
}

function readMode(): MarkdownEditorMode {
  try {
    return globalThis.localStorage?.getItem(MARKDOWN_EDITOR_MODE_KEY) === 'source' ? 'source' : 'rich'
  } catch {
    return 'rich'
  }
}

function writeMode(mode: MarkdownEditorMode) {
  try {
    globalThis.localStorage?.setItem(MARKDOWN_EDITOR_MODE_KEY, mode)
  } catch {
    // The choice only lasts for this editor.
  }
}

const richEditorSx = {
  '& .ProseMirror': {
    ...markdownBodySx('body2'),
    maxHeight: 320,
    minHeight: 60,
    outline: 'none',
    overflowY: 'auto',
    px: 1.25,
    py: 1,
    '& p.is-editor-empty:first-of-type::before': { color: 'text.disabled', content: 'attr(data-placeholder)', float: 'left', height: 0, pointerEvents: 'none' },
    '& ul[data-type="taskList"]': { listStyle: 'none', pl: 0.5 },
    '& ul[data-type="taskList"] li': { alignItems: 'flex-start', display: 'flex', gap: 0.75 },
    '& ul[data-type="taskList"] li > div': { flex: 1, minWidth: 0 },
    '& ul[data-type="taskList"] li > label': { lineHeight: 1, pt: 0.5 },
    '& ul[data-type="taskList"] li p, & td p, & th p': { my: 0 },
    '& td, & th': { border: 1, borderColor: 'divider', minWidth: 48, px: 1, py: 0.5 },
    '& [data-markdown-image]': { color: 'text.secondary', fontSize: 'caption.fontSize' },
    '& a': { color: 'primary.main' },
    '& .selectedCell': { bgcolor: 'action.selected' },
  },
}
