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
import { useConnection } from '../connections/ConnectionProvider'
import { useGitLabQuery } from '../shared/useGitLabQuery'
import { positionLabel } from './diffLineThreads'
import { MAX_SUGGESTION_LINES_ABOVE, suggestionBlock } from './suggestions'

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
      setAttachmentError('添付ファイルは10 MiB以下にしてください。')
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
  const suggestionHint = suggestionLines === null ? '変更前の行（削除行）で終わるコメントには提案を付けられません' : '選択した行の現在の内容から変更提案を作成します'
  const insertSuggestion = () => {
    const lines = suggestionLines?.()
    if (!lines) { setSuggestionError('選択した行の内容を差分から読み取れませんでした。差分を更新してから行を選び直してください。'); return }
    if (lines.length - 1 > MAX_SUGGESTION_LINES_ABOVE) { setSuggestionError(`提案はコメント行から上${MAX_SUGGESTION_LINES_ABOVE}行までです。範囲を狭めてください。`); return }
    setSuggestionError(null)
    editorRef.current?.insertBlock(suggestionBlock(lines))
  }
  return (
    // A reply opens in place of the thread's reply field, so it has no frame or heading of its own.
    <Paper component="section" aria-label="レビューコメント入力" data-composer="" sx={replyDiscussionId ? { bgcolor: 'transparent', border: 0, p: 0 } : { p: 1.5 }} variant="outlined">
      <Stack spacing={1}>
        {replyDiscussionId ? null : <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', flexWrap: 'wrap', minWidth: 0, rowGap: 0.5 }}>
          <Typography sx={{ fontWeight: 600 }} variant="body2">{inlineTarget ? `${targetLabel} にコメント` : 'コメントを追加'}</Typography>
          {targetPosition && !inlineTarget ? <Chip disabled={targetControlsDisabled} label={targetLabel} onDelete={() => { if (!uploadingRef.current) onClearPosition() }} size="small" sx={composerChipSx} variant="outlined" /> : null}
        </Stack>}
        <MarkdownEditor
          activeDescendantId={mentionListShown ? mentionOptionId(mentionListId, activeMentionIndex) : null}
          autoFocus={Boolean(replyDiscussionId) || inlineTarget}
          controlsId={mentionListShown ? mentionListId : null}
          disabled={controlsDisabled}
          label="コメント本文"
          onChange={updateValue}
          onKeyDown={handleKeyDown}
          onMentionQueryChange={enableMentions ? (query) => { setMentionQuery(query); setActiveMentionIndex(0) } : undefined}
          onPasteImage={onUploadAttachment ? (file) => { void uploadAttachment(file) } : undefined}
          placeholder={replyAuthor ? `${replyAuthor}に返信` : 'Markdownでコメントを書けます'}
          ref={editorRef}
          toolbarEnd={onUploadAttachment || suggestionLines !== undefined ? <>
            {suggestionLines !== undefined ? (
              <Tooltip title={suggestionHint}>
                <span>
                  <Button disabled={controlsDisabled || !suggestionLines} onClick={insertSuggestion} size="small" startIcon={<DifferenceOutlinedIcon />}>提案を挿入</Button>
                </span>
              </Tooltip>
            ) : null}
            {onUploadAttachment ? (
            <Tooltip title="ファイルを添付（コメント投稿前にGitLabへアップロード・10 MiBまで。画像は貼り付けでも可）">
              <span>
                <IconButton aria-label={uploading ? '添付ファイルをアップロード中…' : 'ファイルを添付'} component="label" disabled={targetControlsDisabled} size="small">
                  <AttachFileRoundedIcon />
                  <input
                    aria-label="添付ファイルを選択"
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
        {uploading ? <Typography aria-live="polite" color="textSecondary" variant="caption">添付ファイルをアップロード中です。投稿先は変更できませんが、本文の入力は続けられます。</Typography> : null}
        {attachmentError ? <Alert onClose={() => setAttachmentError(null)} severity="error">{attachmentError}</Alert> : null}
        {suggestionError ? <Alert onClose={() => setSuggestionError(null)} severity="warning">{suggestionError}</Alert> : null}
        {enableMentions ? <MentionSuggestions id={mentionListId} onSelect={insertMention} onUsersChange={onMentionCandidatesChange} search={controlsDisabled ? '' : mentionQuery ?? ''} selectedIndex={activeMentionIndex} /> : null}
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 1 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flex: '1 1 auto', flexWrap: 'wrap', minWidth: 0, rowGap: 0.5 }}>
            {/* Line comments always start a resolvable thread. */}
            {!replyDiscussionId && !targetPosition ? <FormControlLabel control={<Checkbox checked={thread} disabled={controlsDisabled} onChange={(event) => setThread(event.target.checked)} size="small" />} label="解決可能なスレッドとして投稿" sx={{ mr: 0 }} /> : null}
            {uploading ? null : <Typography color="textSecondary" variant="caption">Ctrl+Enter: レビューに追加 · Ctrl+Shift+Enter: 今すぐ投稿</Typography>}
          </Stack>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexShrink: 0, ml: 'auto' }}>
            {replyDiscussionId || inlineTarget ? <Tooltip title="入力した本文は保持されます (Esc)"><span><Button disabled={targetControlsDisabled} onClick={() => { if (!uploadingRef.current) close() }} size="small">閉じる</Button></span></Tooltip> : null}
            {/* GitLab's two actions: keep it in the pending review, or publish it now. */}
            <Tooltip title="未公開レビューに追加し、あとでまとめて公開します (Ctrl+Enter)"><span><Button disabled={targetControlsDisabled || !value.trim()} onClick={() => void submit('draft')} startIcon={<AddCommentRoundedIcon />} variant="outlined">レビューに追加</Button></span></Tooltip>
            <Tooltip title="すぐにMRへ投稿します (Ctrl+Shift+Enter)"><span><Button disabled={targetControlsDisabled || !value.trim()} onClick={() => void submit('comment')} startIcon={<SendRoundedIcon />} variant="outlined">
              {uploading ? '添付ファイルをアップロード中…' : pending || submitting ? '送信中…' : replyDiscussionId ? '返信' : 'コメントを投稿'}
            </Button></span></Tooltip>
          </Stack>
        </Stack>
      </Stack>
    </Paper>
  )
}

function MentionSuggestions({ id, onSelect, onUsersChange, search, selectedIndex }: { id: string; onSelect: (user: GitLabUser) => void; onUsersChange: (users: GitLabUser[]) => void; search: string; selectedIndex: number }) {
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
      {search.trim() !== debouncedSearch || result.loading ? <Typography color="textSecondary" role="status" sx={{ display: 'block', p: 1 }} variant="caption">ユーザー候補を検索中…</Typography> : null}
      {search.trim() === debouncedSearch && !result.loading && users.length === 0 ? <Typography color="textSecondary" role="status" sx={{ display: 'block', p: 1 }} variant="caption">候補がありません。</Typography> : null}
      {/* The editor keeps the focus; ↑/↓ move aria-activedescendant through these options. */}
      <Box aria-label="メンション候補" component="ul" id={id} role="listbox" sx={{ listStyle: 'none', m: 0, p: 0 }}>
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
  if (code === 'TOO_LARGE') return '添付ファイルは10 MiB以下にしてください。'
  if (code === 'FORBIDDEN') return 'GitLabが添付を拒否しました。プロジェクトの権限を確認してください。'
  if (code === 'AUTH_REQUIRED') return 'GitLabに接続してから添付してください。'
  if (code === 'STORAGE') return '入力の保存を確認できないため、添付を停止しました。'
  if (code === 'UNKNOWN_OUTCOME') return 'アップロード結果を確認できません。GitLabで添付の有無を確認してから再試行してください。'
  return '添付ファイルをアップロードできませんでした。GitLabへの接続と権限を確認してください。'
}
