import AddCommentRoundedIcon from '@mui/icons-material/AddCommentRounded'
import AttachFileRoundedIcon from '@mui/icons-material/AttachFileRounded'
import DifferenceOutlinedIcon from '@mui/icons-material/DifferenceOutlined'
import SendRoundedIcon from '@mui/icons-material/SendRounded'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Checkbox from '@mui/material/Checkbox'
import FormControlLabel from '@mui/material/FormControlLabel'
import IconButton from '@mui/material/IconButton'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { frame } from '../../components/hairline'
import { MarkdownEditor, type MarkdownEditorHandle, type MarkdownEditorKeyEvent } from '../../components/MarkdownEditor'
import { gridLine } from '../../theme'
import { attachmentErrorMessage, MAX_GITLAB_ATTACHMENT_BYTES } from '../../lib/attachments'
import type { GitLabUser, Position } from '../../types/gitlab'
import { positionLabel } from './diffLineThreads'
import { MAX_SUGGESTION_LINES_ABOVE, suggestionBlock } from './suggestions'
import { TemplateMenu } from './TemplateMenu'
import { useMentionSuggestions } from './useMentionSuggestions'
import { useT } from '../../i18n/useT'
import { Row } from '../../components/Row'

interface ReviewComposerProps {
  attachmentTargetKey?: string
  disabled?: boolean
  enableMentions?: boolean
  /** People of the MR, offered as soon as `@` is typed and ahead of other users. */
  mentionParticipants?: GitLabUser[]
  pending?: boolean
  replyAuthor?: string
  replyDiscussionId?: string
  targetPosition?: Position
  /** Opened under a diff line: it closes (keeping the text) instead of only dropping the line. */
  inlineTarget?: boolean
  onCancelReply: () => void
  onClearPosition: () => void
  onChange: (body: string) => void
  onSaveDraft: (body: string, position?: Position) => Promise<boolean>
  onSubmitComment: (body: string, thread: boolean, position?: Position) => Promise<boolean>
  onUploadAttachment?: (file: File) => Promise<string | null>
  /** Keeps a link whose upload finished after this editor was closed or retargeted. */
  onDetachedAttachment?: (markdown: string) => void
  /**
   * Reads the current text of the commented lines, which 「提案を挿入」 starts
   * a suggestion from; null when the lines allow no suggestion (a comment
   * ending on a removed line). Without it the button is not shown.
   */
  suggestionLines?: (() => string[] | null) | null
  /** The project whose comment templates are offered; without it the button is not shown. */
  templateProjectPath?: string
  value: string
}

export function ReviewComposer({
  attachmentTargetKey,
  disabled = false,
  enableMentions = false,
  inlineTarget = false,
  mentionParticipants = EMPTY_USERS,
  onCancelReply,
  onChange,
  onClearPosition,
  onSaveDraft,
  onSubmitComment,
  onUploadAttachment,
  onDetachedAttachment,
  pending = false,
  replyAuthor,
  replyDiscussionId,
  suggestionLines,
  targetPosition,
  templateProjectPath,
  value,
}: ReviewComposerProps) {
  const t = useT()
  const [thread, setThread] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [suggestionError, setSuggestionError] = useState<string | null>(null)
  const submittingRef = useRef(false)
  const uploadingRef = useRef(false)
  const mountedRef = useRef(true)
  const editorRef = useRef<MarkdownEditorHandle | null>(null)
  const valueRef = useRef(value)
  const onChangeRef = useRef(onChange)
  const fallbackTargetKey = JSON.stringify({ discussionId: replyDiscussionId ?? '', position: targetPosition ?? null })
  const currentTargetKey: unknown = attachmentTargetKey ?? onUploadAttachment ?? fallbackTargetKey
  const targetKeyRef = useRef(currentTargetKey)
  const updateValue = useCallback((nextValue: string) => {
    valueRef.current = nextValue
    onChangeRef.current(nextValue)
  }, [])

  useLayoutEffect(() => {
    valueRef.current = value
    onChangeRef.current = onChange
    targetKeyRef.current = currentTargetKey
  }, [currentTargetKey, onChange, value])

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // Showing a screen KeepAlive hid runs this again; only a newly chosen target takes the focus (and the caret to the end).
  const focusedTargetRef = useRef<string | null>(null)
  useEffect(() => {
    const target = replyDiscussionId ?? (inlineTarget ? '' : null)
    // A remount of this composer (the diff laid out anew) gets its caret and focus back from the editor instead.
    if (target !== null && target !== focusedTargetRef.current && !editorRef.current?.restoredCaret()) editorRef.current?.focus()
    focusedTargetRef.current = target
  }, [inlineTarget, replyDiscussionId])

  const submit = async (submitKind: 'comment' | 'draft') => {
    const trimmed = valueRef.current.trim()
    if (!trimmed || pending || disabled || submittingRef.current || uploadingRef.current) return
    submittingRef.current = true
    setSubmitting(true)
    try {
      const success = submitKind === 'draft'
        ? await onSaveDraft(trimmed, targetPosition)
        : await onSubmitComment(trimmed, thread || Boolean(replyDiscussionId), targetPosition)
      if (success) updateValue('')
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }
  const controlsDisabled = disabled || (pending && !uploading) || submitting
  const targetControlsDisabled = controlsDisabled || uploading
  const { containerRef: mentionContainerRef, editorProps: mentionEditorProps, handleKeyDown: handleMentionKeyDown, popup: mentionPopup } = useMentionSuggestions({ disabled: controlsDisabled, editorRef, enabled: enableMentions, participants: mentionParticipants, value })

  const uploadAttachment = async (file: File) => {
    if (!onUploadAttachment || disabled || pending || submittingRef.current || uploadingRef.current) return
    if (file.size > MAX_GITLAB_ATTACHMENT_BYTES) {
      setAttachmentError(t('review.attachment.tooLarge'))
      return
    }

    const targetKey = targetKeyRef.current
    const keepDetached = onDetachedAttachment
    uploadingRef.current = true
    setUploading(true)
    setAttachmentError(null)
    try {
      const snippet = (await onUploadAttachment(file))?.trim()
      if (!snippet) return
      if (!mountedRef.current || targetKeyRef.current !== targetKey) {
        // The file is already on GitLab; keep its link with the original input.
        keepDetached?.(snippet)
        return
      }

      editorRef.current?.insertBlock(snippet)
    } catch (caught) {
      if (mountedRef.current && targetKeyRef.current === targetKey) setAttachmentError(attachmentErrorMessage(caught))
    } finally {
      uploadingRef.current = false
      if (mountedRef.current) setUploading(false)
    }
  }

  const handleKeyDown = (event: MarkdownEditorKeyEvent) => {
    if (handleMentionKeyDown(event)) return true
    if ((replyDiscussionId || inlineTarget) && event.key === 'Escape' && !targetControlsDisabled && !uploadingRef.current) {
      // The body stays in its buffer, so closing loses nothing.
      event.preventDefault()
      close()
      return true
    }
    if (event.key !== 'Enter' || !event.ctrlKey) return false
    event.preventDefault()
    void submit(event.shiftKey ? 'comment' : 'draft')
    return true
  }

  const close = replyDiscussionId ? onCancelReply : onClearPosition
  const targetLabel = targetPosition ? positionLabel(targetPosition) : ''
  const suggestionHint = suggestionLines === null ? t('review.composer.suggestion.unavailable') : t('review.composer.suggestion.hint')
  const insertSuggestion = () => {
    const lines = suggestionLines?.()
    if (!lines) { setSuggestionError(t('review.composer.suggestion.unreadable')); return }
    if (lines.length - 1 > MAX_SUGGESTION_LINES_ABOVE) { setSuggestionError(t('review.composer.suggestion.tooMany', { count: MAX_SUGGESTION_LINES_ABOVE })); return }
    setSuggestionError(null)
    editorRef.current?.insertBlock(suggestionBlock(lines))
  }
  return (
    // A reply opens in place of the thread's reply field, so it has no frame or heading of its own.
    <Paper component="section" ref={mentionContainerRef} aria-label={t('review.composer.label')} data-composer="" sx={replyDiscussionId ? { bgcolor: 'transparent', p: 0, '&::after': { content: 'none' } } : { p: 1.5 }} variant="outlined">
      <Stack spacing={1}>
        {replyDiscussionId ? null : <Row spacing={0.5} sx={{ flexWrap: 'wrap', minWidth: 0, rowGap: 0.5 }}>
          <Typography sx={{ fontWeight: 600 }} variant="body2">{inlineTarget ? t('review.composer.commentOn', { target: targetLabel }) : t('review.composer.addComment')}</Typography>
          {targetPosition && !inlineTarget ? <Chip disabled={targetControlsDisabled} label={targetLabel} onDelete={() => { if (!uploadingRef.current) onClearPosition() }} size="small" sx={composerChipSx} variant="outlined" /> : null}
        </Row>}
        <MarkdownEditor
          {...mentionEditorProps}
          autoFocus={Boolean(replyDiscussionId) || inlineTarget}
          disabled={controlsDisabled}
          label={t('review.composer.body')}
          onChange={updateValue}
          onKeyDown={handleKeyDown}
          onPasteImage={onUploadAttachment ? (file) => { void uploadAttachment(file) } : undefined}
          placeholder={replyAuthor ? t('review.composer.replyTo', { author: replyAuthor }) : t('review.composer.placeholder')}
          ref={editorRef}
          restoreKey={attachmentTargetKey ?? fallbackTargetKey}
          toolbarEnd={onUploadAttachment || suggestionLines !== undefined || templateProjectPath ? <>
            {templateProjectPath ? <TemplateMenu disabled={controlsDisabled} onInsert={(content) => editorRef.current?.insertBlock(content)} query={{ kind: 'commentTemplates', projectPath: templateProjectPath }} /> : null}
            {suggestionLines !== undefined ? (
              <Tooltip title={suggestionHint}>
                <span>
                  <Button disabled={controlsDisabled || !suggestionLines} onClick={insertSuggestion} size="small" startIcon={<DifferenceOutlinedIcon />}>{t('review.composer.suggestion.insert')}</Button>
                </span>
              </Tooltip>
            ) : null}
            {onUploadAttachment ? (
            <Tooltip title={t('review.composer.attach.tooltip')}>
              <span>
                <IconButton aria-label={uploading ? t('review.composer.attach.uploading') : t('review.composer.attach.button')} component="label" disabled={targetControlsDisabled} size="small">
                  <AttachFileRoundedIcon />
                  <input
                    aria-label={t('review.composer.attach.input')}
                    hidden
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0]
                      event.currentTarget.value = ''
                      if (file) void uploadAttachment(file)
                    }}
                    type="file"
                  />
                </IconButton>
              </span>
            </Tooltip>
            ) : null}
          </> : null}
          value={value}
        />
        {uploading ? <Typography aria-live="polite" color="textSecondary" variant="caption">{t('review.composer.attach.uploadingNotice')}</Typography> : null}
        {attachmentError ? <Alert onClose={() => setAttachmentError(null)} severity="error">{attachmentError}</Alert> : null}
        {suggestionError ? <Alert onClose={() => setSuggestionError(null)} severity="warning">{suggestionError}</Alert> : null}
        {mentionPopup}
        <Row spacing={1} sx={{ flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 1 }}>
          <Row spacing={1} sx={{ flex: '1 1 auto', flexWrap: 'wrap', minWidth: 0, rowGap: 0.5 }}>
            {/* Line comments always start a resolvable thread. */}
            {!replyDiscussionId && !targetPosition ? <FormControlLabel control={<Checkbox checked={thread} disabled={controlsDisabled} onChange={(event) => setThread(event.target.checked)} size="small" />} label={t('review.composer.thread')} sx={{ mr: 0 }} /> : null}
            {uploading ? null : <Typography color="textSecondary" variant="caption">{t('review.composer.shortcuts')}</Typography>}
          </Row>
          <Row spacing={1} sx={{ flexShrink: 0, ml: 'auto' }}>
            {replyDiscussionId || inlineTarget ? <Tooltip title={t('review.composer.closeTooltip')}><span><Button disabled={targetControlsDisabled} onClick={() => { if (!uploadingRef.current) close() }} size="small">{t('review.composer.close')}</Button></span></Tooltip> : null}
            {/* GitLab's two actions: keep it in the pending review, or publish it now. */}
            <Tooltip title={t('review.composer.addToReviewTooltip')}><span><Button disabled={targetControlsDisabled || !value.trim()} onClick={() => void submit('draft')} startIcon={<AddCommentRoundedIcon />} variant="outlined">{t('review.composer.addToReview')}</Button></span></Tooltip>
            <Tooltip title={t('review.composer.postNowTooltip')}><span><Button disabled={targetControlsDisabled || !value.trim()} onClick={() => void submit('comment')} startIcon={<SendRoundedIcon />} variant="outlined">
              {uploading ? t('review.composer.attach.uploading') : pending || submitting ? t('review.composer.sending') : replyDiscussionId ? t('review.composer.reply') : t('review.composer.post')}
            </Button></span></Tooltip>
          </Row>
        </Row>
      </Stack>
    </Paper>
  )
}

const EMPTY_USERS: GitLabUser[] = []

const composerChipSx = {
  border: 0,
  ...frame({ color: 'surface.borderStrong' }),
  height: 'auto',
  maxWidth: '100%',
  minWidth: 0,
  '& .MuiChip-label': { lineHeight: gridLine(5), overflowWrap: 'anywhere', py: 0, whiteSpace: 'normal' },
}
