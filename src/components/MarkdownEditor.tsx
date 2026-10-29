import Box from '@mui/material/Box'
import InputBase from '@mui/material/InputBase'
import Stack from '@mui/material/Stack'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import type { Editor, EditorOptions } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import { EditorContent, useEditor } from '@tiptap/react'
import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type FocusEvent as ReactFocusEvent, type ReactNode, type Ref } from 'react'

import type { MarkdownFormat } from '../lib/markdownFormat'
import { shownOffsetOfSource, sourceOffsetOfShown } from '../lib/markdownPosition'
import { applyRichFormat, canEditAsRichText, createRichMarkdownExtensions, getEditorMarkdown, richTextBefore, shownText } from '../lib/richMarkdown'
import { gridLine } from '../theme'
import { hairline, panelFrame } from './hairline'
import { useT } from '../i18n/useT'
import { findScrollContainer } from '../features/mergeRequests/discussionScroll'
import { insertTextareaText, useMarkdownFormatting } from '../features/shared/useMarkdownFormatting'
import { MarkdownToolbar } from './MarkdownToolbar'
import { markdownBodySx } from './markdownBodySx'
import { alignTop } from './rows'

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
  /** Where that `@query` starts on screen, for placing its candidates; null without one. */
  mentionAnchorRect: () => DOMRect | null
  /** Whether mounting took back the caret of the editor with the same restoreKey, so callers leave the focus as it was. */
  restoredCaret: () => boolean
}

interface MarkdownEditorProps {
  /** The highlighted option of a suggestion list the input controls, such as mention candidates. */
  activeDescendantId?: string | null
  /** The id of that suggestion list while it is shown. */
  controlsId?: string | null
  autoFocus?: boolean
  disabled?: boolean
  label: string
  placeholder?: string
  ref?: Ref<MarkdownEditorHandle>
  /**
   * Identifies the text being written. An editor mounted right after one with the same key unmounted,
   * as when the diff around a line comment is laid out anew, takes over its caret and focus.
   */
  restoreKey?: string
  /** Extra toolbar controls, such as attaching a file. */
  toolbarEnd?: ReactNode
  value: string
  onChange: (value: string) => void
  /** Runs before the editor's own key handling; return true when the key was used. */
  onKeyDown?: (event: MarkdownEditorKeyEvent) => boolean
  /** Reports the `@query` at the caret (empty right after `@`), or null. */
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
  const t = useT()
  const sourceRef = useRef<SourceInputHandle | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const toolbarRef = useRef<HTMLDivElement | null>(null)
  // Focusing on mount puts the caret at the end and scrolls there, so only the editor first opened takes focus.
  // After a mode switch the other input takes the same selection, in its own offsets: source offsets in the
  // Markdown input, offsets in the shown text in the rich editor.
  const [switchedCaret, setSwitchedCaret] = useState<SwitchedSelection | null>(null)

  const changeMode = (next: MarkdownEditorMode) => {
    if (next === 'rich' && !canEditAsRichText(value)) {
      setRichBlocked(true)
      return
    }
    if (rootRef.current && toolbarRef.current) keepReadingPosition(rootRef.current, toolbarRef.current)
    let selection: SwitchedSelection | null = null
    if (mode === 'rich' && richRef.current) {
      const { doc, selection: current } = richRef.current.state
      const shown = richTextBefore(doc, doc.content.size)
      selection = { anchor: sourceOffsetOfShown(value, shown, richTextBefore(doc, current.anchor).length), head: sourceOffsetOfShown(value, shown, richTextBefore(doc, current.head).length) }
    } else if (mode === 'source') {
      const current = sourceRef.current?.selection()
      const shown = shownText(value)
      if (current) selection = { anchor: shownOffsetOfSource(value, shown, current.anchor), head: shownOffsetOfSource(value, shown, current.head) }
    }
    inputProps.onMentionQueryChange?.(null)
    setRichBlocked(false)
    setSwitchedCaret(selection ?? { anchor: Number.MAX_SAFE_INTEGER, head: Number.MAX_SAFE_INTEGER })
    setPreferredMode(next)
    writeMode(next)
  }

  const applyFormat = (format: MarkdownFormat) => {
    const rich = mode === 'rich' ? richRef.current : null
    const apply = () => {
      if (rich) applyRichFormat(rich, format)
      else sourceRef.current?.applyFormat(format)
    }
    // A format applied while the IME is converting ends the conversion and leaves its text twice.
    const target = rich ? rich.view.dom : sourceRef.current?.element()
    const composing = rich ? rich.view.composing : sourceRef.current?.composing()
    if (!target || !composing) {
      apply()
      return
    }
    // ProseMirror reads the confirmed text a moment after the conversion ends.
    target.addEventListener('compositionend', () => { setTimeout(apply, COMPOSITION_SETTLE_MS) }, { once: true })
  }

  return (
    <Box ref={rootRef} sx={{ bgcolor: 'background.paper', ...panelFrame({ color: 'surface.inputBorder' }), borderRadius: 1, minWidth: 0, '&:focus-within::after': { borderColor: 'primary.main', borderWidth: '2px' } }}>
      {/* The editor grows with its text, so its toolbar stays in view below the MR header. */}
      <Stack direction="row" ref={toolbarRef} sx={{ alignItems: 'center', bgcolor: 'background.paper', ...hairline('bottom', { position: false }), borderTopLeftRadius: 'inherit', borderTopRightRadius: 'inherit', columnGap: 0.5, flexWrap: 'wrap', position: 'sticky', px: 0.5, py: 0.5, top: 'var(--composer-sticky-top, var(--detail-header-height, 0px))', zIndex: 1 }}>
        <MarkdownToolbar
          disabled={disabled}
          onFormat={applyFormat}
        />
        {toolbarEnd}
        <ToggleButtonGroup
          aria-label={t('common.markdownEditor.mode')}
          disabled={disabled}
          exclusive
          onChange={(_, next: MarkdownEditorMode | null) => { if (next) changeMode(next) }}
          size="small"
          sx={{ ml: 'auto' }}
          value={mode}
        >
          <ToggleButton sx={{ px: 1, py: 0.25 }} title={t('common.markdownEditor.richTitle')} value="rich">{t('common.markdownEditor.rich')}</ToggleButton>
          <ToggleButton sx={{ px: 1, py: 0.25 }} title={t('common.markdownEditor.sourceTitle')} value="source">Markdown</ToggleButton>
        </ToggleButtonGroup>
      </Stack>
      {mode === 'rich'
        ? <RichInput {...inputProps} autoFocus={inputProps.autoFocus && switchedCaret === null} editorRef={richRef} handleRef={ref} initialCaret={switchedCaret} onUnsupported={() => setRichBlocked(true)} />
        : <SourceInput {...inputProps} autoFocus={inputProps.autoFocus && switchedCaret === null} handleRef={ref} initialCaret={switchedCaret} inputHandleRef={sourceRef} />}
      {richBlocked && preferredMode === 'rich' ? (
        <Typography color="textSecondary" component="p" sx={{ ...hairline('top'), px: 1, py: 0.5 }} variant="caption">
          {t('common.markdownEditor.richBlocked', { label })}
        </Typography>
      ) : null}
    </Box>
  )
}

interface InputProps extends Omit<MarkdownEditorProps, 'ref' | 'toolbarEnd'> {
  handleRef?: Ref<MarkdownEditorHandle>
  /** The selection to focus on mount after a mode switch; null to follow autoFocus. */
  initialCaret: SwitchedSelection | null
}

/** A selection carried across a mode switch, in the offsets of the input it goes to. */
interface SwitchedSelection { anchor: number; head: number }

const COMPOSITION_SETTLE_MS = 50

function RichInput({ activeDescendantId, autoFocus, controlsId, disabled = false, editorRef, handleRef, initialCaret, label, onChange, onKeyDown, onMentionQueryChange, onPasteImage, onUnsupported, placeholder, restoreKey, value }: InputProps & { editorRef: { current: Editor | null }; onUnsupported: () => void }) {
  const lastValueRef = useRef(value)
  const [mountCaret] = useState(initialCaret)
  // Refs outlive the editor, which TipTap destroys while KeepAlive hides the screen and creates again when it shows.
  const createdRef = useRef(false)
  const selectionRef = useRef<{ anchor: number; head: number } | null>(null)
  const mountedRef = useRef(false)
  const keptRef = useRef<KeptCaret | null>(null)
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

  // useEditor applies options that changed since the last render to the editor, which redraws it and ends an IME
  // conversion in progress, so they stay the same while typing re-renders: the text is followed by the effect below.
  const [initialContent] = useState(value)
  const extensions = useMemo(() => createRichMarkdownExtensions(placeholder), [placeholder])
  const editorProps = useMemo<EditorOptions['editorProps']>(() => ({
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
      const data = event.clipboardData
      const image = data ? imageFromClipboard(data) : null
      const onPaste = callbacksRef.current.onPasteImage
      if (image && onPaste) {
        onPaste(image)
        return true
      }
      // Plain text is read as the Markdown it is saved as, so `# 見出し` shows as the heading GitLab renders.
      // Formatted text from a page keeps its formatting, and a code block takes text as written.
      const text = data?.getData('text/plain')
      const current = editorRef.current
      if (!text || data?.getData('text/html') || !current || current.isActive('codeBlock')) return false
      current.chain().focus().insertContent(text, { contentType: 'markdown' }).run()
      return true
    },
  }), [editorRef, label])

  // Null between TipTap destroying the editor of a screen kept hidden for a while and creating it again when the screen shows.
  const editor: Editor | null = useEditor({
    // Focused in onCreate instead: autofocus would also move the caret to the end and scroll there each time the editor is created again.
    autofocus: false,
    content: initialContent,
    contentType: 'markdown',
    editable: !disabled,
    editorProps,
    extensions,
    onBlur: ({ event }) => { if (leftForElsewhere(event, controlsId)) callbacksRef.current.onMentionQueryChange?.(null) },
    onCreate: ({ editor: current }) => {
      const saved = selectionRef.current
      const kept = createdRef.current ? null : keptRef.current
      // Created again from the text it had first; take the text written since, which Ctrl+Z does not take back.
      if (createdRef.current && lastValueRef.current !== initialContent) current.chain().setMeta('addToHistory', false).setContent(lastValueRef.current, { contentType: 'markdown', emitUpdate: false }).run()
      if (createdRef.current || kept) {
        if (saved) {
          const { doc } = current.state
          current.view.dispatch(current.state.tr.setSelection(TextSelection.between(doc.resolve(Math.min(saved.anchor, doc.content.size)), doc.resolve(Math.min(saved.head, doc.content.size)))))
          // Unfocused now, so a restored caret in an `@query` offers no candidates.
          callbacksRef.current.onMentionQueryChange?.(null)
        }
        if (kept?.focused) current.commands.focus(null, { scrollIntoView: false })
      } else if (mountCaret !== null) {
        const { doc } = current.state
        current.view.dispatch(current.state.tr.setSelection(TextSelection.between(doc.resolve(richPosAtShown(doc, mountCaret.anchor)), doc.resolve(richPosAtShown(doc, mountCaret.head)))))
        current.commands.focus(null, { scrollIntoView: false })
      }
      else if (autoFocus) current.commands.focus('end')
      createdRef.current = true
    },
    onSelectionUpdate: ({ editor: current }) => reportMention(current),
    onTransaction: ({ editor: current }) => { selectionRef.current = { anchor: current.state.selection.anchor, head: current.state.selection.head } },
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
    editor?.setEditable(!disabled, false)
  }, [disabled, editor])

  const wrapperRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    // ProseMirror only manages the attributes it set itself, so these stay until changed here.
    const dom = wrapperRef.current?.querySelector('.ProseMirror')
    if (!dom) return
    setOptionalAttribute(dom, 'aria-activedescendant', activeDescendantId)
    setOptionalAttribute(dom, 'aria-controls', controlsId)
  }, [activeDescendantId, controlsId, editor])

  useLayoutEffect(() => {
    // Only mounting takes a kept caret, not KeepAlive showing the screen again; onCreate applies it.
    if (!mountedRef.current) {
      mountedRef.current = true
      keptRef.current = takeCaret(restoreKey, 'rich')
      if (keptRef.current) selectionRef.current = { anchor: keptRef.current.anchor, head: keptRef.current.head }
    }
    const wrapper = wrapperRef.current
    return () => {
      const selection = selectionRef.current
      if (restoreKey && selection) keepCaret(restoreKey, { ...selection, focused: Boolean(wrapper?.contains(document.activeElement)), mode: 'rich' })
    }
  }, [restoreKey])

  useEffect(() => {
    // Follow changes made outside the editor: clearing after submit, restored or appended text.
    if (!editor || value === lastValueRef.current) return
    lastValueRef.current = value
    if (!canEditAsRichText(value)) {
      onUnsupported()
      return
    }
    editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false })
  }, [editor, onUnsupported, value])

  useImperativeHandle(handleRef, () => ({
    // Effects can run again after the editor is destroyed (StrictMode, remounts); there is nothing to focus then.
    focus: () => { if (editor && !editor.isDestroyed) editor.commands.focus('end') },
    insertBlock: (markdown) => { editor?.chain().focus().insertContent(markdown, { contentType: 'markdown' }).run() },
    insertMention: (text) => {
      const range = mentionRef.current
      if (!range || !editor) return
      const tail = editor.state.doc.textBetween(range.to, Math.min(range.to + 1, editor.state.selection.$from.end()), undefined, '￼')
      const separator = tail && /^[\s.,!?)]/.test(tail) ? '' : ' '
      editor.chain().focus().insertContentAt(range, { text: `${text}${separator}`, type: 'text' }).run()
    },
    mentionAnchorRect: () => {
      const range = mentionRef.current
      if (!range || !editor || editor.isDestroyed) return null
      try {
        const coords = editor.view.coordsAtPos(range.from)
        return new DOMRect(coords.left, coords.top, 0, coords.bottom - coords.top)
      } catch {
        // Not laid out, as in tests.
        return null
      }
    },
    restoredCaret: () => keptRef.current !== null,
  }), [editor])

  return <Box ref={wrapperRef} sx={richEditorSx}><EditorContent editor={editor} /></Box>
}

interface SourceInputHandle {
  applyFormat: ReturnType<typeof useMarkdownFormatting>['applyFormat']
  /** Whether the IME is converting text in the input. */
  composing: () => boolean
  element: () => HTMLTextAreaElement | null
  selection: () => SwitchedSelection | null
}

function SourceInput({ activeDescendantId, autoFocus, controlsId, disabled = false, handleRef, initialCaret, inputHandleRef, label, onChange, onKeyDown, onMentionQueryChange, onPasteImage, placeholder, restoreKey, value }: InputProps & { inputHandleRef: { current: SourceInputHandle | null } }) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const valueRef = useRef(value)
  const mentionRef = useRef<{ start: number; end: number } | null>(null)
  const pendingCursorRef = useRef<number | null>(null)
  const composingRef = useRef(false)
  const updateValue = (next: string) => {
    valueRef.current = next
    onChange(next)
  }
  /** Inserts in a way Ctrl+Z undoes, and puts the caret at `caret` of the resulting text. */
  const replaceText = (start: number, end: number, text: string, caret: number) => {
    const textarea = inputRef.current
    if (textarea && insertTextareaText(textarea, start, end, text)) {
      textarea.setSelectionRange(caret, caret)
      return
    }
    const currentValue = valueRef.current
    pendingCursorRef.current = caret
    updateValue(`${currentValue.slice(0, start)}${text}${currentValue.slice(end)}`)
    textarea?.focus()
  }
  const { applyFormat, handleFormatShortcut } = useMarkdownFormatting(inputRef, value, updateValue)
  const [mount] = useState({ autoFocus, caret: initialCaret })
  const mountedRef = useRef(false)
  const keptRef = useRef<KeptCaret | null>(null)

  useLayoutEffect(() => {
    // Effects run again when KeepAlive shows the screen, as does InputBase's autoFocus; only mounting takes the focus.
    const textarea = inputRef.current
    if (mountedRef.current || !textarea) return
    mountedRef.current = true
    const kept = keptRef.current = takeCaret(restoreKey, 'source')
    if (kept) {
      textarea.setSelectionRange(kept.anchor, kept.head)
      if (kept.focused) textarea.focus({ preventScroll: true })
    } else if (mount.caret !== null) {
      const { anchor, head } = mount.caret
      textarea.setSelectionRange(Math.min(anchor, head), Math.max(anchor, head), head < anchor ? 'backward' : 'forward')
      textarea.focus({ preventScroll: true })
    } else if (mount.autoFocus) textarea.focus()
  }, [mount, restoreKey])

  useLayoutEffect(() => {
    const textarea = inputRef.current
    return () => { if (restoreKey && textarea) keepCaret(restoreKey, { anchor: textarea.selectionStart, focused: document.activeElement === textarea, head: textarea.selectionEnd, mode: 'source' }) }
  }, [restoreKey])

  useLayoutEffect(() => {
    valueRef.current = value
    inputHandleRef.current = {
      applyFormat,
      composing: () => composingRef.current,
      element: () => inputRef.current,
      selection: () => {
        const textarea = inputRef.current
        if (!textarea) return null
        const backward = textarea.selectionDirection === 'backward'
        return { anchor: backward ? textarea.selectionEnd : textarea.selectionStart, head: backward ? textarea.selectionStart : textarea.selectionEnd }
      },
    }
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
      replaceText(start, start, `${leadingNewline}${markdown}${trailingNewline}`, start + leadingNewline.length + markdown.length)
    },
    insertMention: (text) => {
      const range = mentionRef.current
      if (!range) return
      const tail = valueRef.current.slice(range.end)
      const insertion = `${text}${tail && /^[\s.,!?)]/.test(tail) ? '' : ' '}`
      mentionRef.current = null
      replaceText(range.start, range.end, insertion, range.start + insertion.length)
    },
    mentionAnchorRect: () => {
      const range = mentionRef.current
      return range && inputRef.current ? textareaCaretRect(inputRef.current, range.start) : null
    },
    restoredCaret: () => keptRef.current !== null,
  }))

  return (
    <InputBase
      disabled={disabled}
      fullWidth
      // InputBase calls this without an event when it is disabled while focused.
      onBlur={(event?: ReactFocusEvent) => { if (!event || leftForElsewhere(event.nativeEvent, controlsId)) onMentionQueryChange?.(null) }}
      inputProps={{
        'aria-activedescendant': activeDescendantId ?? undefined, 'aria-controls': controlsId ?? undefined, 'aria-label': label,
        onCompositionEnd: () => { composingRef.current = false },
        onCompositionStart: () => { composingRef.current = true },
      }}
      inputRef={inputRef}
      minRows={2}
      multiline
      onChange={(event) => {
        updateValue(event.target.value)
        reportMention()
      }}
      onClick={reportMention}
      onKeyDown={(event) => {
        // Keys such as Enter confirm the IME's text then, as in the rich editor.
        if (event.nativeEvent.isComposing) return
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
      sx={{ fontFamily: 'code.fontFamily', fontSize: 'body2.fontSize', lineHeight: gridLine(5), px: 1, py: 1 }}
      value={value}
    />
  )
}

/** Focus left the input, not for its suggestion list (or the box scrolling it) nor only for another window. */
function leftForElsewhere(event: FocusEvent, controlsId: string | null | undefined): boolean {
  if (!document.hasFocus()) return false
  const list = controlsId ? document.getElementById(controlsId) : null
  const next = event.relatedTarget
  return !(list && next instanceof Node && (list.contains(next) || next.contains(list)))
}

/** The position after `count` code units of the text the rich editor shows. */
function richPosAtShown(doc: ProseMirrorNode, count: number): number {
  let remaining = count
  let found: number | null = null
  doc.descendants((node, pos) => {
    if (found !== null) return false
    if (!node.isText) return true
    if (remaining <= node.nodeSize) found = pos + remaining
    else remaining -= node.nodeSize
    return false
  })
  return found ?? doc.content.size
}

interface KeptCaret { anchor: number; focused: boolean; head: number; mode: MarkdownEditorMode }

/** Carets of editors unmounted in this task, for one mounted again at once with the same restoreKey. Undo history is not carried over. */
const keptCarets = new Map<string, KeptCaret>()

function keepCaret(key: string, caret: KeptCaret) {
  keptCarets.set(key, caret)
  setTimeout(() => { if (keptCarets.get(key) === caret) keptCarets.delete(key) }, 0)
}

function takeCaret(key: string | undefined, mode: MarkdownEditorMode): KeptCaret | null {
  const caret = key === undefined ? undefined : keptCarets.get(key)
  if (key !== undefined) keptCarets.delete(key)
  return caret?.mode === mode ? caret : null
}

function setOptionalAttribute(element: Element, name: string, value: string | null | undefined) {
  if (value) element.setAttribute(name, value)
  else element.removeAttribute(name)
}

/** Office apps put a rendered image next to copied text; that text is pasted, not the image. */
function imageFromClipboard(data: DataTransfer): File | null {
  if (data.getData('text/plain')) return null
  return Array.from(data.items).find((item) => item.kind === 'file' && item.type.startsWith('image/'))?.getAsFile() ?? null
}

/** The `@query` around the caret; `before`/`after` count its characters on each side of the caret. */
function findMention(beforeCaret: string, afterCaret: string): { after: number; before: number; query: string } | null {
  // A full-width ＠ from an IME starts one too; the query may be part of a display name in any script.
  const match = /(?:^|[\s([{])[@\uFF20]([^\s@\uFF20()[\]{}<>,;:!?'"`\uFFFC]*)$/u.exec(beforeCaret)
  if (!match) return null
  const trailing = /^[^\s@\uFF20()[\]{}<>,;:!?'"`\uFFFC]*/u.exec(afterCaret)?.[0] ?? ''
  return { after: trailing.length, before: match[1].length + 1, query: `${match[1]}${trailing}` }
}

/** The textarea's caret position on screen, measured by laying out its text in a hidden copy. */
function textareaCaretRect(textarea: HTMLTextAreaElement, index: number): DOMRect {
  const style = globalThis.getComputedStyle(textarea)
  const mirror = document.createElement('div')
  for (const name of MIRRORED_TEXTAREA_STYLES) mirror.style.setProperty(name, style.getPropertyValue(name))
  Object.assign(mirror.style, { left: '0', overflowWrap: 'break-word', position: 'absolute', top: '0', visibility: 'hidden', whiteSpace: 'pre-wrap' })
  mirror.textContent = textarea.value.slice(0, index)
  const marker = document.createElement('span')
  marker.textContent = '\u200b'
  mirror.append(marker)
  document.body.append(mirror)
  const box = textarea.getBoundingClientRect()
  const rect = new DOMRect(box.left + marker.offsetLeft - textarea.scrollLeft, box.top + marker.offsetTop - textarea.scrollTop, 0, marker.offsetHeight)
  mirror.remove()
  return rect
}

const MIRRORED_TEXTAREA_STYLES = ['box-sizing', 'width', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width', 'border-style', 'font-family', 'font-size', 'font-style', 'font-weight', 'letter-spacing', 'line-height', 'tab-size', 'text-transform', 'word-spacing']

/**
 * The two modes lay the same text out at different heights. When the toolbar is stuck over the text,
 * keep the same share of the text at its lower edge once the other mode has rendered.
 */
function keepReadingPosition(root: HTMLElement, toolbar: HTMLElement) {
  const host = findScrollContainer(root)
  const read = () => {
    const box = root.getBoundingClientRect()
    const textTop = box.top + toolbar.offsetHeight
    return { height: box.bottom - textTop, offset: toolbar.getBoundingClientRect().bottom - textTop }
  }
  const before = read()
  if (!host || before.offset <= 0 || before.height <= 0) return
  // The rich editor mounts its content in an effect; the next frame is still before paint.
  requestAnimationFrame(() => {
    const after = read()
    host.scrollTop += after.height * (before.offset / before.height) - after.offset
  })
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
    minHeight: 60,
    outline: 'none',
    px: 1,
    py: 1,
    '& p.is-editor-empty:first-of-type::before': { color: 'text.secondary', content: 'attr(data-placeholder)', float: 'left', height: 0, pointerEvents: 'none' },
    '& ul[data-type="taskList"]': { listStyle: 'none', pl: 0.5 },
    '& ul[data-type="taskList"] li': { ...alignTop, display: 'flex', gap: 1 },
    '& ul[data-type="taskList"] li > div': { flex: 1, minWidth: 0 },
    '& ul[data-type="taskList"] li > label': { lineHeight: 1, pt: 0.5 },
    '& ul[data-type="taskList"] li p, & td p, & th p': { my: 0 },
    '& td, & th': { ...hairline(['right', 'bottom']), minWidth: 48, px: 1, py: 0.5 },
    '& [data-markdown-image]': { color: 'text.secondary', fontSize: 'caption.fontSize' },
    '& a': { color: 'primary.main' },
    '& .selectedCell': { bgcolor: 'action.selected' },
  },
}
