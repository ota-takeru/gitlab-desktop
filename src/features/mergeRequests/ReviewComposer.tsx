import AddCommentRoundedIcon from '@mui/icons-material/AddCommentRounded'
import CodeOutlinedIcon from '@mui/icons-material/CodeOutlined'
import PreviewOutlinedIcon from '@mui/icons-material/PreviewOutlined'
import SendRoundedIcon from '@mui/icons-material/SendRounded'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Checkbox from '@mui/material/Checkbox'
import FormControlLabel from '@mui/material/FormControlLabel'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { MockMarkdown } from '../../components/mock/MockMarkdown'
import type { GitLabUser, Position, UsersQuery } from '../../types/gitlab'
import { useConnection } from '../connections/ConnectionProvider'
import { useGitLabQuery } from '../shared/useGitLabQuery'

interface ReviewComposerProps {
  disabled?: boolean
  enableMentions?: boolean
  pending?: boolean
  replyAuthor?: string
  replyDiscussionId?: string
  targetPosition?: Position
  onCancelReply: () => void
  onClearPosition: () => void
  onChange: (body: string) => void
  onSaveDraft: (body: string, position?: Position) => Promise<boolean>
  onSubmitComment: (body: string, thread: boolean, position?: Position) => Promise<boolean>
  value: string
}

export function ReviewComposer({
  disabled = false,
  enableMentions = false,
  onCancelReply,
  onChange,
  onClearPosition,
  onSaveDraft,
  onSubmitComment,
  pending = false,
  replyAuthor,
  replyDiscussionId,
  targetPosition,
  value,
}: ReviewComposerProps) {
  const [kind, setKind] = useState<'comment' | 'draft'>('comment')
  const [editorMode, setEditorMode] = useState<'edit' | 'preview'>('edit')
  const [thread, setThread] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [previousReplyDiscussionId, setPreviousReplyDiscussionId] = useState(replyDiscussionId)
  const [mentionRange, setMentionRange] = useState<MentionRange | null>(null)
  const [mentionCandidates, setMentionCandidates] = useState<GitLabUser[]>([])
  const [activeMentionIndex, setActiveMentionIndex] = useState(0)
  const submittingRef = useRef(false)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const pendingCursorRef = useRef<number | null>(null)

  if (previousReplyDiscussionId !== replyDiscussionId) {
    setPreviousReplyDiscussionId(replyDiscussionId)
    if (replyDiscussionId) setEditorMode('edit')
  }

  useEffect(() => {
    if (replyDiscussionId && editorMode === 'edit') inputRef.current?.focus()
  }, [editorMode, replyDiscussionId])

  useLayoutEffect(() => {
    if (pendingCursorRef.current === null || !inputRef.current) return
    const cursor = pendingCursorRef.current
    inputRef.current.setSelectionRange(cursor, cursor)
    pendingCursorRef.current = null
  }, [value])

  const onMentionCandidatesChange = useCallback((users: GitLabUser[]) => {
    setMentionCandidates(users)
    setActiveMentionIndex(0)
  }, [])

  const submit = async (submitKind: 'comment' | 'draft') => {
    const trimmed = value.trim()
    if (!trimmed || pending || disabled || submittingRef.current) return
    submittingRef.current = true
    setSubmitting(true)
    try {
      const success = submitKind === 'draft'
        ? await onSaveDraft(trimmed, targetPosition)
        : await onSubmitComment(trimmed, thread || Boolean(replyDiscussionId), targetPosition)
      if (success) onChange('')
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }
  const controlsDisabled = disabled || pending || submitting
  const showMentionCandidates = Boolean(enableMentions && editorMode === 'edit' && mentionRange && mentionRange.query.length >= 2)
  const visibleMentionCandidates = mentionCandidates.slice(0, 8)

  const updateMentionRange = (textarea: HTMLTextAreaElement) => {
    const nextRange = findMentionAtCaret(textarea.value, textarea.selectionStart, textarea.selectionEnd)
    setMentionRange(nextRange && nextRange.query.length >= 2 ? nextRange : null)
    setActiveMentionIndex(0)
  }

  const insertMention = (user: GitLabUser) => {
    const textarea = inputRef.current
    if (!textarea || !mentionRange) return
    const mention = `@${user.username}`
    const tail = value.slice(mentionRange.end)
    const separator = tail && /^[\s.,!?)]/.test(tail) ? '' : ' '
    const insertion = `${mention}${separator}`
    const nextValue = `${value.slice(0, mentionRange.start)}${insertion}${tail}`
    pendingCursorRef.current = mentionRange.start + insertion.length
    onChange(nextValue)
    setMentionRange(null)
    setMentionCandidates([])
    textarea.focus()
  }

  return (
    <Paper component="section" aria-label="レビューコメント入力" sx={{ p: 1.25 }} variant="outlined">
      <Stack spacing={0.75}>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', flexWrap: 'wrap', minWidth: 0, rowGap: 0.5 }}>
          <Typography sx={{ fontWeight: 600 }} variant="body2">{replyAuthor ? `${replyAuthor}に返信` : 'コメントを追加'}</Typography>
          {replyDiscussionId ? <Chip disabled={controlsDisabled} label="スレッド返信" onDelete={onCancelReply} size="small" sx={composerChipSx} variant="outlined" /> : null}
          {targetPosition ? <Chip disabled={controlsDisabled} label={`${targetPosition.newPath}:${targetPosition.newLine ?? targetPosition.oldLine ?? 'file'}`} onDelete={onClearPosition} size="small" sx={composerChipSx} title={`${targetPosition.newPath}:${targetPosition.newLine ?? targetPosition.oldLine ?? 'file'}`} variant="outlined" /> : null}
        </Stack>
        <Stack spacing={0.5}>
          <ToggleButtonGroup
            aria-label="コメント編集モード"
            exclusive
            onChange={(_, next: 'edit' | 'preview' | null) => { if (next) setEditorMode(next) }}
            size="small"
            value={editorMode}
          >
            <ToggleButton aria-label="コメントを編集" value="edit"><CodeOutlinedIcon fontSize="small" sx={{ mr: 0.5 }} />編集</ToggleButton>
            <ToggleButton aria-label="コメントをプレビュー" value="preview"><PreviewOutlinedIcon fontSize="small" sx={{ mr: 0.5 }} />プレビュー</ToggleButton>
          </ToggleButtonGroup>
          {editorMode === 'edit' ? (
            <>
              <TextField
                disabled={controlsDisabled}
                fullWidth
                inputRef={inputRef}
                label="コメント本文"
                multiline
                minRows={2}
                maxRows={10}
                onChange={(event) => {
                  onChange(event.target.value)
                  if (enableMentions && inputRef.current) updateMentionRange(inputRef.current)
                }}
                onClick={() => { if (enableMentions && inputRef.current) updateMentionRange(inputRef.current) }}
                onKeyUp={() => { if (enableMentions && inputRef.current) updateMentionRange(inputRef.current) }}
                onKeyDown={(event) => {
                  if (showMentionCandidates && visibleMentionCandidates.length > 0) {
                    if (event.key === 'ArrowDown') {
                      event.preventDefault()
                      setActiveMentionIndex((current) => (current + 1) % visibleMentionCandidates.length)
                      return
                    }
                    if (event.key === 'ArrowUp') {
                      event.preventDefault()
                      setActiveMentionIndex((current) => (current - 1 + visibleMentionCandidates.length) % visibleMentionCandidates.length)
                      return
                    }
                    if (event.key === 'Enter' && !event.ctrlKey && !event.shiftKey) {
                      event.preventDefault()
                      insertMention(visibleMentionCandidates[activeMentionIndex] ?? visibleMentionCandidates[0])
                      return
                    }
                  }
                  if (showMentionCandidates && event.key === 'Escape') {
                    event.preventDefault()
                    setMentionRange(null)
                    setMentionCandidates([])
                    return
                  }
                  if (event.key !== 'Enter' || !event.ctrlKey) return
                  event.preventDefault()
                  void submit(event.shiftKey ? 'comment' : 'draft')
                }}
                placeholder="Markdownでコメントを書けます。Ctrl+Enter: レビューに追加 / Ctrl+Shift+Enter: 今すぐコメント"
                value={value}
              />
              {enableMentions ? <MentionSuggestions onSelect={insertMention} onUsersChange={onMentionCandidatesChange} search={controlsDisabled ? '' : mentionRange?.query ?? ''} selectedIndex={activeMentionIndex} /> : null}
            </>
          ) : (
            <Paper aria-label="コメントプレビュー" sx={{ bgcolor: 'background.default', minHeight: 72, maxHeight: 240, overflow: 'auto', p: 1 }} variant="outlined">
              {value.trim() ? <MockMarkdown body={value} /> : <Typography color="text.secondary" variant="body2">プレビューする内容がありません。</Typography>}
            </Paper>
          )}
        </Stack>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 0.75 }}>
          <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flex: '1 1 auto', flexWrap: 'wrap', minWidth: 0, rowGap: 0.5 }}>
            <ToggleButtonGroup disabled={controlsDisabled} exclusive onChange={(_, value: 'comment' | 'draft' | null) => { if (value) setKind(value) }} size="small" value={kind}>
              <ToggleButton value="comment">今すぐコメント</ToggleButton>
              <ToggleButton value="draft">レビューに追加</ToggleButton>
            </ToggleButtonGroup>
            {!replyDiscussionId && kind === 'comment' ? <FormControlLabel control={<Checkbox checked={thread} disabled={controlsDisabled} onChange={(event) => setThread(event.target.checked)} size="small" />} label="解決可能なスレッドとして投稿" sx={{ mr: 0 }} /> : null}
          </Stack>
          <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexShrink: 0, ml: 'auto' }}>
            {replyDiscussionId ? <Button disabled={controlsDisabled} onClick={onCancelReply} size="small">返信を取消</Button> : null}
            <Button disabled={controlsDisabled || !value.trim()} onClick={() => void submit(kind)} startIcon={kind === 'draft' ? <AddCommentRoundedIcon /> : <SendRoundedIcon />} variant="contained">
              {pending || submitting ? '送信中…' : kind === 'draft' ? '下書きに追加' : 'コメントを投稿'}
            </Button>
          </Stack>
        </Stack>
      </Stack>
    </Paper>
  )
}

interface MentionRange {
  end: number
  query: string
  start: number
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

function findMentionAtCaret(value: string, selectionStart: number, selectionEnd: number): MentionRange | null {
  if (selectionStart !== selectionEnd) return null
  const beforeCaret = value.slice(0, selectionStart)
  const match = /(?:^|[\s([{])@([a-zA-Z0-9_.-]*)$/.exec(beforeCaret)
  if (!match) return null
  const start = selectionStart - match[1].length - 1
  const trailingToken = /^[a-zA-Z0-9_.-]*/.exec(value.slice(selectionEnd))?.[0] ?? ''
  return { end: selectionEnd + trailingToken.length, query: `${match[1]}${trailingToken}`, start }
}

const EMPTY_USERS: GitLabUser[] = []

const composerChipSx = {
  height: 'auto',
  maxWidth: '100%',
  minWidth: 0,
  '& .MuiChip-label': { overflowWrap: 'anywhere', py: 0.25, whiteSpace: 'normal' },
}
