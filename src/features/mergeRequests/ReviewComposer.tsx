import AddCommentRoundedIcon from '@mui/icons-material/AddCommentRounded'
import SendRoundedIcon from '@mui/icons-material/SendRounded'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Checkbox from '@mui/material/Checkbox'
import FormControlLabel from '@mui/material/FormControlLabel'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import { useEffect, useRef, useState } from 'react'

import type { Position } from '../../types/gitlab'

interface ReviewComposerProps {
  disabled?: boolean
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
  const [thread, setThread] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    if (replyDiscussionId) inputRef.current?.focus()
  }, [replyDiscussionId])

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

  return (
    <Paper component="section" aria-label="レビューコメント入力" sx={{ p: 1.5 }} variant="outlined">
      <Stack spacing={1.25}>
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography sx={{ fontWeight: 700 }} variant="body2">{replyAuthor ? `${replyAuthor}に返信` : 'コメントを追加'}</Typography>
          {replyDiscussionId ? <Chip disabled={controlsDisabled} label="スレッド返信" onDelete={onCancelReply} size="small" variant="outlined" /> : null}
          {targetPosition ? <Chip disabled={controlsDisabled} label={`${targetPosition.newPath}:${targetPosition.newLine ?? targetPosition.oldLine ?? 'file'}`} onDelete={onClearPosition} size="small" variant="outlined" /> : null}
        </Stack>
        <TextField
          disabled={controlsDisabled}
          fullWidth
          inputRef={inputRef}
          label="コメント本文"
          multiline
          minRows={3}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || !event.ctrlKey) return
            event.preventDefault()
            void submit(event.shiftKey ? 'comment' : 'draft')
          }}
          placeholder="Markdownでコメントを書けます。Ctrl+Enter: レビューに追加 / Ctrl+Shift+Enter: 今すぐコメント"
          value={value}
        />
        <Stack direction={{ sm: 'row', xs: 'column' }} spacing={1} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}>
          <ToggleButtonGroup disabled={controlsDisabled} exclusive onChange={(_, value: 'comment' | 'draft' | null) => { if (value) setKind(value) }} size="small" value={kind}>
            <ToggleButton value="comment">今すぐコメント</ToggleButton>
            <ToggleButton value="draft">レビューに追加</ToggleButton>
          </ToggleButtonGroup>
          {!replyDiscussionId && kind === 'comment' ? <FormControlLabel control={<Checkbox checked={thread} disabled={controlsDisabled} onChange={(event) => setThread(event.target.checked)} size="small" />} label="解決可能なスレッドとして投稿" sx={{ mr: 0 }} /> : null}
          <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
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
