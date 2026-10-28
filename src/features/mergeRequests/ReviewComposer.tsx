import AddCommentRoundedIcon from '@mui/icons-material/AddCommentRounded'
import AttachFileRoundedIcon from '@mui/icons-material/AttachFileRounded'
import DifferenceOutlinedIcon from '@mui/icons-material/DifferenceOutlined'
import SendRoundedIcon from '@mui/icons-material/SendRounded'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Checkbox from '@mui/material/Checkbox'
import FormControlLabel from '@mui/material/FormControlLabel'
import IconButton from '@mui/material/IconButton'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'

import { MarkdownEditor, type MarkdownEditorHandle, type MarkdownEditorKeyEvent } from '../../components/MarkdownEditor'
import { MAX_GITLAB_ATTACHMENT_BYTES } from '../../lib/attachments'
import type { GitLabUser, Position, UsersQuery } from '../../types/gitlab'
import { useConnection } from '../connections/connectionContext'
import { useGitLabQuery } from '../shared/useGitLabQuery'
import { positionLabel } from './diffLineThreads'
import { MAX_SUGGESTION_LINES_ABOVE, suggestionBlock } from './suggestions'
import { translate } from '../../i18n/i18n'
import { useT } from '../../i18n/useT'

interface ReviewComposerProps {
  attachmentTargetKey?: string
  disabled?: boolean
  enableMentions?: boolean
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
  value: string
}

export function ReviewComposer({
  attachmentTargetKey,
  disabled = false,
  enableMentions = false,
  inlineTarget = false,
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
  value,
}: ReviewComposerProps) {
  const t = useT()
  const [thread, setThread] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [suggestionError, setSuggestionError] = useState<string | null>(null)
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionCandidates, setMentionCandidates] = useState<GitLabUser[]>([])
  const [activeMentionIndex, setActiveMentionIndex] = useState(0)
  const submittingRef = useRef(false)
  const uploadingRef = useRef(false)
  const mountedRef = useRef(true)
  const editorRef = useRef<MarkdownEditorHandle | null>(null)
  const mentionListId = useId()
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

  useEffect(() => {
    if (replyDiscussionId || inlineTarget) editorRef.current?.focus()
  }, [inlineTarget, replyDiscussionId])

  const onMentionCandidatesChange = useCallback((users: GitLabUser[]) => {
    setMentionCandidates(users)
    setActiveMentionIndex(0)
  }, [])

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
  const showMentionCandidates = Boolean(enableMentions && mentionQuery)
  const visibleMentionCandidates = mentionCandidates.slice(0, 8)
  const mentionListShown = showMentionCandidates && visibleMentionCandidates.length > 0 && !controlsDisabled

  const insertMention = (user: GitLabUser) => {
    editorRef.current?.insertMention(`@${user.username}`)
    setMentionQuery(null)
    setMentionCandidates([])
  }

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
      if (mountedRef.current && targetKeyRef.current === targetKey) setAttachmentError(getAttachmentErrorMessage(caught))
    } finally {
      uploadingRef.current = false
      if (mountedRef.current) setUploading(false)
    }
  }

  const handleKeyDown = (event: MarkdownEditorKeyEvent) => {
    if (showMentionCandidates && visibleMentionCandidates.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActiveMentionIndex((current) => (current + 1) % visibleMentionCandidates.length)
        return true
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveMentionIndex((current) => (current - 1 + visibleMentionCandidates.length) % visibleMentionCandidates.length)
        return true
      }
      if (event.key === 'Enter' && !event.ctrlKey && !event.shiftKey) {
        event.preventDefault()
        insertMention(visibleMentionCandidates[activeMentionIndex] ?? visibleMentionCandidates[0])
        return true
      }
    }
    if (showMentionCandidates && event.key === 'Escape') {
      event.preventDefault()
      setMentionQuery(null)
      setMentionCandidates([])
      return true
    }
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
    <Paper component="section" aria-label={t('review.composer.label')} data-composer="" sx={replyDiscussionId ? { bgcolor: 'transparent', border: 0, p: 0 } : { p: 1.5 }} variant="outlined">
      <Stack spacing={1}>
        {replyDiscussionId ? null : <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', flexWrap: 'wrap', minWidth: 0, rowGap: 0.5 }}>
          <Typography sx={{ fontWeight: 600 }} variant="body2">{inlineTarget ? t('review.composer.commentOn', { target: targetLabel }) : t('review.composer.addComment')}</Typography>
          {targetPosition && !inlineTarget ? <Chip disabled={targetControlsDisabled} label={targetLabel} onDelete={() => { if (!uploadingRef.current) onClearPosition() }} size="small" sx={composerChipSx} variant="outlined" /> : null}
        </Stack>}
        <MarkdownEditor
          activeDescendantId={mentionListShown ? mentionOptionId(mentionListId, activeMentionIndex) : null}
          autoFocus={Boolean(replyDiscussionId) || inlineTarget}
          controlsId={mentionListShown ? mentionListId : null}
          disabled={controlsDisabled}
          label={t('review.composer.body')}
          onChange={updateValue}
          onKeyDown={handleKeyDown}
          onMentionQueryChange={enableMentions ? (query) => { setMentionQuery(query); setActiveMentionIndex(0) } : undefined}
          onPasteImage={onUploadAttachment ? (file) => { void uploadAttachment(file) } : undefined}
          placeholder={replyAuthor ? t('review.composer.replyTo', { author: replyAuthor }) : t('review.composer.placeholder')}
          ref={editorRef}
          toolbarEnd={onUploadAttachment || suggestionLines !== undefined ? <>
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
        {enableMentions ? <MentionSuggestions id={mentionListId} onSelect={insertMention} onUsersChange={onMentionCandidatesChange} search={controlsDisabled ? '' : mentionQuery ?? ''} selectedIndex={activeMentionIndex} /> : null}
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 1 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flex: '1 1 auto', flexWrap: 'wrap', minWidth: 0, rowGap: 0.5 }}>
            {/* Line comments always start a resolvable thread. */}
            {!replyDiscussionId && !targetPosition ? <FormControlLabel control={<Checkbox checked={thread} disabled={controlsDisabled} onChange={(event) => setThread(event.target.checked)} size="small" />} label={t('review.composer.thread')} sx={{ mr: 0 }} /> : null}
            {uploading ? null : <Typography color="textSecondary" variant="caption">{t('review.composer.shortcuts')}</Typography>}
          </Stack>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexShrink: 0, ml: 'auto' }}>
            {replyDiscussionId || inlineTarget ? <Tooltip title={t('review.composer.closeTooltip')}><span><Button disabled={targetControlsDisabled} onClick={() => { if (!uploadingRef.current) close() }} size="small">{t('review.composer.close')}</Button></span></Tooltip> : null}
            {/* GitLab's two actions: keep it in the pending review, or publish it now. */}
            <Tooltip title={t('review.composer.addToReviewTooltip')}><span><Button disabled={targetControlsDisabled || !value.trim()} onClick={() => void submit('draft')} startIcon={<AddCommentRoundedIcon />} variant="outlined">{t('review.composer.addToReview')}</Button></span></Tooltip>
            <Tooltip title={t('review.composer.postNowTooltip')}><span><Button disabled={targetControlsDisabled || !value.trim()} onClick={() => void submit('comment')} startIcon={<SendRoundedIcon />} variant="outlined">
              {uploading ? t('review.composer.attach.uploading') : pending || submitting ? t('review.composer.sending') : replyDiscussionId ? t('review.composer.reply') : t('review.composer.post')}
            </Button></span></Tooltip>
          </Stack>
        </Stack>
      </Stack>
    </Paper>
  )
}

function MentionSuggestions({ id, onSelect, onUsersChange, search, selectedIndex }: { id: string; onSelect: (user: GitLabUser) => void; onUsersChange: (users: GitLabUser[]) => void; search: string; selectedIndex: number }) {
  const t = useT()
  const { session } = useConnection()
  const [debouncedSearch, setDebouncedSearch] = useState('')

  useEffect(() => {
    const timer = globalThis.setTimeout(() => setDebouncedSearch(search.trim()), 350)
    return () => globalThis.clearTimeout(timer)
  }, [search])

  const query: UsersQuery | null = session && search.trim().length >= 2 && search.trim() === debouncedSearch
    ? { kind: 'users', page: 1, search: debouncedSearch }
    : null
  const result = useGitLabQuery<UsersQuery>(session?.id ?? null, query)
  const users = search.trim() === debouncedSearch ? (result.data ?? EMPTY_USERS) : EMPTY_USERS

  useEffect(() => {
    onUsersChange(users)
  }, [onUsersChange, users])

  if (search.trim().length < 2) return null
  return (
    <Paper sx={{ maxHeight: 180, overflowY: 'auto', p: 0.5 }} variant="outlined">
      {search.trim() !== debouncedSearch || result.loading ? <Typography color="textSecondary" role="status" sx={{ display: 'block', p: 1 }} variant="caption">{t('review.mention.searching')}</Typography> : null}
      {search.trim() === debouncedSearch && !result.loading && users.length === 0 ? <Typography color="textSecondary" role="status" sx={{ display: 'block', p: 1 }} variant="caption">{t('review.mention.none')}</Typography> : null}
      {/* The editor keeps the focus; ↑/↓ move aria-activedescendant through these options. */}
      <Box aria-label={t('review.mention.label')} component="ul" id={id} role="listbox" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {users.slice(0, 8).map((user, index) => (
          <Box
            aria-selected={index === selectedIndex}
            component="li"
            id={mentionOptionId(id, index)}
            key={user.id}
            onClick={() => onSelect(user)}
            onMouseDown={(event) => event.preventDefault()}
            role="option"
            sx={{ bgcolor: index === selectedIndex ? 'action.selected' : 'transparent', borderRadius: 1, cursor: 'pointer', px: 1, py: 0.5, '&:hover': { bgcolor: 'action.hover' } }}
          ><Typography component="span" variant="body2">{user.name}</Typography><Typography color="textSecondary" component="span" sx={{ ml: 1 }} variant="caption">@{user.username}</Typography></Box>
        ))}
      </Box>
    </Paper>
  )
}

function mentionOptionId(listId: string, index: number): string {
  return `${listId}-option-${index}`
}

const EMPTY_USERS: GitLabUser[] = []

const composerChipSx = {
  height: 'auto',
  maxWidth: '100%',
  minWidth: 0,
  '& .MuiChip-label': { overflowWrap: 'anywhere', py: 0.25, whiteSpace: 'normal' },
}

function getAttachmentErrorMessage(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : ''
  if (code === 'TOO_LARGE') return translate('review.attachment.tooLarge')
  if (code === 'FORBIDDEN') return translate('review.attachment.forbidden')
  if (code === 'AUTH_REQUIRED') return translate('review.attachment.authRequired')
  if (code === 'STORAGE') return translate('review.attachment.storage')
  if (code === 'UNKNOWN_OUTCOME') return translate('review.attachment.unknownOutcome')
  return translate('review.attachment.failed')
}
