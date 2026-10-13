import AddCommentRoundedIcon from '@mui/icons-material/AddCommentRounded'
import AttachFileRoundedIcon from '@mui/icons-material/AttachFileRounded'
import SendRoundedIcon from '@mui/icons-material/SendRounded'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Checkbox from '@mui/material/Checkbox'
import FormControlLabel from '@mui/material/FormControlLabel'
import IconButton from '@mui/material/IconButton'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import { MarkdownEditor, type MarkdownEditorHandle, type MarkdownEditorKeyEvent } from '../../components/MarkdownEditor'
import { MAX_GITLAB_ATTACHMENT_BYTES } from '../../lib/attachments'
import type { GitLabUser, Position, UsersQuery } from '../../types/gitlab'
import { useConnection } from '../connections/ConnectionProvider'
import { useGitLabQuery } from '../shared/useGitLabQuery'

interface ReviewComposerProps {
  attachmentTargetKey?: string
  disabled?: boolean
  enableMentions?: boolean
  pending?: boolean
  replyAuthor?: string
  replyDiscussionId?: string
  targetPosition?: Position
  /** The code the target position points at, shown above the editor. */
  targetCode?: ReactNode
  onCancelReply: () => void
  onClearPosition: () => void
  onChange: (body: string) => void
  onSaveDraft: (body: string, position?: Position) => Promise<boolean>
  onSubmitComment: (body: string, thread: boolean, position?: Position) => Promise<boolean>
  onUploadAttachment?: (file: File) => Promise<string | null>
  /** Keeps a link whose upload finished after this editor was closed or retargeted. */
  onDetachedAttachment?: (markdown: string) => void
  value: string
}

export function ReviewComposer({
  attachmentTargetKey,
  disabled = false,
  enableMentions = false,
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
  targetCode,
  targetPosition,
  value,
}: ReviewComposerProps) {
  const [kind, setKind] = useState<'comment' | 'draft'>('comment')
  const [thread, setThread] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionCandidates, setMentionCandidates] = useState<GitLabUser[]>([])
  const [activeMentionIndex, setActiveMentionIndex] = useState(0)
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

  useEffect(() => {
    if (replyDiscussionId) editorRef.current?.focus()
  }, [replyDiscussionId])

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
    if (replyDiscussionId && event.key === 'Escape' && !targetControlsDisabled && !uploadingRef.current) {
      // The reply body stays in its buffer, so closing loses nothing.
      event.preventDefault()
      onCancelReply()
      return true
    }
    if (event.key !== 'Enter' || !event.ctrlKey) return false
    event.preventDefault()
    void submit(event.shiftKey ? 'comment' : 'draft')
    return true
  }

  return (
    // A reply opens in place of the thread's reply field, so it has no frame or heading of its own.
    <Paper component="section" aria-label="レビューコメント入力" sx={replyDiscussionId ? { bgcolor: 'transparent', border: 0, p: 0 } : { p: 1.25 }} variant="outlined">
      <Stack spacing={0.75}>
        {replyDiscussionId ? null : <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', flexWrap: 'wrap', minWidth: 0, rowGap: 0.5 }}>
          <Typography sx={{ fontWeight: 600 }} variant="body2">コメントを追加</Typography>
          {targetPosition ? <Chip disabled={targetControlsDisabled} label={`${targetPosition.newPath}:${targetPosition.newLine ?? targetPosition.oldLine ?? 'file'}`} onDelete={() => { if (!uploadingRef.current) onClearPosition() }} size="small" sx={composerChipSx} title={`${targetPosition.newPath}:${targetPosition.newLine ?? targetPosition.oldLine ?? 'file'}`} variant="outlined" /> : null}
        </Stack>}
        {targetPosition ? targetCode : null}
        <MarkdownEditor
          disabled={controlsDisabled}
          label="コメント本文"
          onChange={updateValue}
          onKeyDown={handleKeyDown}
          onMentionQueryChange={enableMentions ? (query) => { setMentionQuery(query); setActiveMentionIndex(0) } : undefined}
          onPasteImage={onUploadAttachment ? (file) => { void uploadAttachment(file) } : undefined}
          placeholder={`${replyAuthor ? `${replyAuthor}に返信。` : 'Markdownでコメントを書けます。'}Ctrl+Enter: レビューに追加 / Ctrl+Shift+Enter: 今すぐコメント`}
          ref={editorRef}
          toolbarEnd={onUploadAttachment ? (
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
          value={value}
        />
        {uploading ? <Typography aria-live="polite" color="text.secondary" variant="caption">添付ファイルをアップロード中です。投稿先は変更できませんが、本文の入力は続けられます。</Typography> : null}
        {attachmentError ? <Alert onClose={() => setAttachmentError(null)} severity="error">{attachmentError}</Alert> : null}
        {enableMentions ? <MentionSuggestions onSelect={insertMention} onUsersChange={onMentionCandidatesChange} search={controlsDisabled ? '' : mentionQuery ?? ''} selectedIndex={activeMentionIndex} /> : null}
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 0.75 }}>
          <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flex: '1 1 auto', flexWrap: 'wrap', minWidth: 0, rowGap: 0.5 }}>
            <ToggleButtonGroup disabled={controlsDisabled} exclusive onChange={(_, value: 'comment' | 'draft' | null) => { if (value) setKind(value) }} size="small" value={kind}>
              <ToggleButton value="comment">今すぐコメント</ToggleButton>
              <ToggleButton value="draft">レビューに追加</ToggleButton>
            </ToggleButtonGroup>
            {!replyDiscussionId && kind === 'comment' ? <FormControlLabel control={<Checkbox checked={thread} disabled={controlsDisabled} onChange={(event) => setThread(event.target.checked)} size="small" />} label="解決可能なスレッドとして投稿" sx={{ mr: 0 }} /> : null}
          </Stack>
          <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexShrink: 0, ml: 'auto' }}>
            {replyDiscussionId ? <Button disabled={targetControlsDisabled} onClick={() => { if (!uploadingRef.current) onCancelReply() }} size="small" title="入力した本文は保持されます (Esc)">閉じる</Button> : null}
            <Button disabled={targetControlsDisabled || !value.trim()} onClick={() => void submit(kind)} startIcon={kind === 'draft' ? <AddCommentRoundedIcon /> : <SendRoundedIcon />} variant="contained">
              {uploading ? '添付ファイルをアップロード中…' : pending || submitting ? '送信中…' : kind === 'draft' ? '下書きに追加' : 'コメントを投稿'}
            </Button>
          </Stack>
        </Stack>
      </Stack>
    </Paper>
  )
}

function MentionSuggestions({ onSelect, onUsersChange, search, selectedIndex }: { onSelect: (user: GitLabUser) => void; onUsersChange: (users: GitLabUser[]) => void; search: string; selectedIndex: number }) {
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
    <Paper aria-label="メンション候補" sx={{ maxHeight: 180, overflowY: 'auto', p: 0.5 }} variant="outlined">
      {search.trim() !== debouncedSearch || result.loading ? <Typography color="text.secondary" sx={{ p: 0.75 }} variant="caption">ユーザー候補を検索中…</Typography> : null}
      {search.trim() === debouncedSearch && !result.loading && users.length === 0 ? <Typography color="text.secondary" sx={{ p: 0.75 }} variant="caption">候補がありません。</Typography> : null}
      <Stack spacing={0.25}>
        {users.slice(0, 8).map((user, index) => (
          <Button
            aria-label={`@${user.username}を挿入`}
            aria-pressed={index === selectedIndex}
            key={user.id}
            onClick={() => onSelect(user)}
            onMouseDown={(event) => event.preventDefault()}
            size="small"
            sx={{ justifyContent: 'flex-start', textAlign: 'left', textTransform: 'none' }}
            variant={index === selectedIndex ? 'contained' : 'text'}
          >{user.name} <Typography color="text.secondary" component="span" sx={{ ml: 0.75 }} variant="caption">@{user.username}</Typography></Button>
        ))}
      </Stack>
    </Paper>
  )
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
