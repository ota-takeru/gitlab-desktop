import CheckCircleOutlineOutlinedIcon from '@mui/icons-material/CheckCircleOutlineOutlined'
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import ExpandMoreOutlinedIcon from '@mui/icons-material/ExpandMoreOutlined'
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined'
import ReplyOutlinedIcon from '@mui/icons-material/ReplyOutlined'
import UndoOutlinedIcon from '@mui/icons-material/UndoOutlined'
import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Collapse from '@mui/material/Collapse'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useState } from 'react'

import type { MockDiscussion } from '../../mock/fixtures'
import type { MockCommentPosition } from '../../mock/reviewTypes'
import { MockMarkdown } from './MockMarkdown'

interface MockDiscussionListProps {
  discussions: MockDiscussion[]
  resolvedIds: string[]
  onReply: (discussionId: string) => void
  onToggleResolved: (discussionId: string) => void
  currentUserHandle?: string
  onEditNote?: (discussionId: string, body: string, replyId?: string) => void
  onDeleteNote?: (discussionId: string, replyId?: string) => void
}

export function MockDiscussionList({
  discussions,
  resolvedIds,
  onReply,
  onToggleResolved,
  currentUserHandle = '@otata',
  onEditNote,
  onDeleteNote,
}: MockDiscussionListProps) {
  if (discussions.length === 0) {
    return (
      <Paper variant="outlined" sx={{ bgcolor: 'background.paper', p: 2.5, textAlign: 'center' }}>
        <ForumOutlinedIcon sx={{ color: 'text.disabled', fontSize: 25 }} />
        <Typography sx={{ fontSize: 'body2.fontSize', fontWeight: 700, mt: 0.75 }}>議論はまだありません</Typography>
        <Typography color="text.secondary" sx={{ fontSize: 'caption.fontSize', mt: 0.35 }}>最初のコメントを下書きできます。</Typography>
      </Paper>
    )
  }

  return (
    <Stack spacing={1}>
      {discussions.map((discussion) => {
        const isResolved = resolvedIds.includes(discussion.id) || discussion.state === 'resolved'
        return (
          <DiscussionCard
            key={discussion.id}
            currentUserHandle={currentUserHandle}
            discussion={discussion}
            isResolved={isResolved}
            onDeleteNote={onDeleteNote}
            onEditNote={onEditNote}
            onReply={onReply}
            onToggleResolved={onToggleResolved}
          />
        )
      })}
    </Stack>
  )
}

type EditTarget = 'root' | `reply:${string}`
type DeleteTarget = 'root' | `reply:${string}`

function DiscussionCard({
  discussion,
  isResolved,
  onReply,
  onToggleResolved,
  currentUserHandle,
  onEditNote,
  onDeleteNote,
}: {
  discussion: MockDiscussion
  isResolved: boolean
  onReply: (discussionId: string) => void
  onToggleResolved: (discussionId: string) => void
  currentUserHandle: string
  onEditNote?: (discussionId: string, body: string, replyId?: string) => void
  onDeleteNote?: (discussionId: string, replyId?: string) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const [editingTarget, setEditingTarget] = useState<EditTarget>()
  const [editDraft, setEditDraft] = useState('')
  const [editError, setEditError] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>()

  // Existing fixtures omit kind, so an omitted kind remains the full GitLab
  // discussion/thread shape for backwards-compatible mock rendering.
  const isThread = discussion.kind !== 'comment'
  const position = getPositionLabel(discussion.position, discussion.file, discussion.line)
  const canEditRoot = Boolean(onEditNote) && !discussion.deleted && discussion.author.handle === currentUserHandle
  const canDeleteRoot = Boolean(onDeleteNote) && !discussion.deleted && discussion.author.handle === currentUserHandle

  const beginEdit = (target: EditTarget, body: string) => {
    setEditingTarget(target)
    setEditDraft(body)
    setEditError(false)
  }

  const cancelEdit = () => {
    setEditingTarget(undefined)
    setEditDraft('')
    setEditError(false)
  }

  const saveEdit = (replyId?: string) => {
    if (!editDraft.trim()) {
      setEditError(true)
      return
    }
    onEditNote?.(discussion.id, editDraft.trim(), replyId)
    cancelEdit()
  }

  const confirmDelete = () => {
    if (!deleteTarget) return
    const replyId = deleteTarget === 'root' ? undefined : deleteTarget.slice('reply:'.length)
    onDeleteNote?.(discussion.id, replyId)
    setDeleteTarget(undefined)
  }

  return (
    <Paper component="article" variant="outlined" sx={{ bgcolor: 'background.paper', opacity: isResolved ? 0.82 : 1, p: 1.25 }}>
      <Stack spacing={1}>
        <Stack direction="row" spacing={0.85} sx={{ alignItems: 'center' }}>
          <Avatar sx={{ bgcolor: 'action.hover', color: 'primary.main', fontSize: 'caption.fontSize', fontWeight: 'fontWeightBold', height: 25, width: 25 }}>{discussion.author.initials}</Avatar>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: 'caption.fontSize', fontWeight: 600 }}>{discussion.author.name}</Typography>
            <Typography color="text.secondary" sx={{ fontSize: 'caption.fontSize' }}>{discussion.author.handle} · {discussion.createdAt}{discussion.edited ? ' · 編集済み' : ''}</Typography>
          </Box>
          <Box sx={{ flex: 1 }} />
          {canEditRoot ? (
            <IconButton aria-label="コメントを編集" onClick={() => beginEdit('root', discussion.body)} size="small">
              <EditOutlinedIcon sx={{ fontSize: 16 }} />
            </IconButton>
          ) : null}
          {canDeleteRoot ? (
            <IconButton aria-label="コメントを削除" onClick={() => setDeleteTarget('root')} size="small">
              <DeleteOutlineOutlinedIcon sx={{ fontSize: 16 }} />
            </IconButton>
          ) : null}
          {isThread ? (
            isResolved ? <Chip icon={<CheckCircleOutlineOutlinedIcon />} label="解決済み" size="small" color="success" sx={{ fontSize: 'caption.fontSize', height: 22 }} /> : <Chip label="未解決" size="small" color="warning" sx={{ fontSize: 'caption.fontSize', height: 22 }} />
          ) : null}
          <IconButton aria-label={expanded ? '議論を折りたたむ' : '議論を展開する'} onClick={() => setExpanded((current) => !current)} size="small">
            <ExpandMoreOutlinedIcon sx={{ fontSize: 17, transform: expanded ? 'rotate(180deg)' : undefined, transition: 'transform 120ms ease' }} />
          </IconButton>
        </Stack>
        {position ? (
          <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography color="text.secondary" component="code" variant="code" sx={{ bgcolor: 'action.hover', borderRadius: 0.5, fontSize: 'caption.fontSize', px: 0.65, py: 0.25 }}>
              {position}
            </Typography>
            <Typography color="text.disabled" sx={{ fontSize: 'caption.fontSize' }}>行コメント</Typography>
          </Stack>
        ) : null}
        <Collapse in={expanded}>
          <Stack spacing={1}>
            {editingTarget === 'root' ? (
              <NoteEditor
                error={editError}
                label="コメントを編集"
                value={editDraft}
                onCancel={cancelEdit}
                onChange={(value) => { setEditDraft(value); setEditError(false) }}
                onSave={() => saveEdit()}
              />
            ) : discussion.deleted ? (
              <DeletedNoteBody />
            ) : (
              <NoteBody body={discussion.body} />
            )}
            {discussion.replies.length > 0 ? (
              <Stack spacing={0.75} sx={{ borderLeft: 2, borderColor: 'divider', ml: 1, pl: 1.25 }}>
                {discussion.replies.map((reply) => {
                  const replyTarget = `reply:${reply.id}` as const
                  const canEditReply = Boolean(onEditNote) && reply.author.handle === currentUserHandle
                  const canDeleteReply = Boolean(onDeleteNote) && reply.author.handle === currentUserHandle
                  return (
                    <Box key={reply.id}>
                      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                        <Typography sx={{ fontSize: 'caption.fontSize', fontWeight: 'fontWeightBold' }}>{reply.author.name}</Typography>
                        <Typography color="text.secondary" sx={{ fontSize: 'caption.fontSize' }}>{reply.author.handle} · {reply.createdAt}{reply.edited ? ' · 編集済み' : ''}</Typography>
                        <Box sx={{ flex: 1 }} />
                        {canEditReply ? (
                          <IconButton aria-label="返信を編集" onClick={() => beginEdit(replyTarget, reply.body)} size="small">
                            <EditOutlinedIcon sx={{ fontSize: 15 }} />
                          </IconButton>
                        ) : null}
                        {canDeleteReply ? (
                          <IconButton aria-label="返信を削除" onClick={() => setDeleteTarget(replyTarget)} size="small">
                            <DeleteOutlineOutlinedIcon sx={{ fontSize: 15 }} />
                          </IconButton>
                        ) : null}
                      </Stack>
                      {editingTarget === replyTarget ? (
                        <NoteEditor
                          error={editError}
                          label="返信を編集"
                          value={editDraft}
                          onCancel={cancelEdit}
                          onChange={(value) => { setEditDraft(value); setEditError(false) }}
                          onSave={() => saveEdit(reply.id)}
                        />
                      ) : (
                        <NoteBody body={reply.body} />
                      )}
                    </Box>
                  )
                })}
              </Stack>
            ) : null}
            <Divider />
            <Stack direction="row" spacing={0.5}>
              <Button aria-label={`${discussion.author.name}の議論に返信`} onClick={() => onReply(discussion.id)} size="small" startIcon={<ReplyOutlinedIcon />} sx={{ fontSize: 'caption.fontSize', minWidth: 0, px: 0.75 }}>
                返信
              </Button>
              {isThread ? (
                <Button aria-label={isResolved ? '議論を再開' : '議論を解決'} onClick={() => onToggleResolved(discussion.id)} size="small" startIcon={isResolved ? <UndoOutlinedIcon /> : <CheckCircleOutlineOutlinedIcon />} sx={{ fontSize: 'caption.fontSize', minWidth: 0, px: 0.75 }}>
                  {isResolved ? '再開' : '解決'}
                </Button>
              ) : null}
            </Stack>
          </Stack>
        </Collapse>
      </Stack>
      <Dialog aria-labelledby={`${discussion.id}-delete-title`} onClose={() => setDeleteTarget(undefined)} open={Boolean(deleteTarget)}>
        <DialogTitle id={`${discussion.id}-delete-title`}>コメントを削除しますか？</DialogTitle>
        <DialogContent>
          <DialogContentText>
            このコメントを削除します。この操作はモック内でのみ反映されます。
            {deleteTarget === 'root' && discussion.replies.length > 0 ? ' 既存の返信は残ります。' : ''}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(undefined)}>キャンセル</Button>
          <Button color="error" onClick={confirmDelete} variant="contained">削除を確定</Button>
        </DialogActions>
      </Dialog>
    </Paper>
  )
}

function NoteBody({ body }: { body: string }) {
  return (
    <Box sx={{ fontSize: 'body2.fontSize', lineHeight: 1.65, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>
      <MockMarkdown body={body} />
    </Box>
  )
}

function DeletedNoteBody() {
  return <Typography color="text.secondary" sx={{ fontSize: 'body2.fontSize', fontStyle: 'italic', lineHeight: 1.65 }}>コメントは削除されました</Typography>
}

function NoteEditor({
  label,
  value,
  error,
  onChange,
  onCancel,
  onSave,
}: {
  label: string
  value: string
  error: boolean
  onChange: (value: string) => void
  onCancel: () => void
  onSave: () => void
}) {
  return (
    <Stack spacing={0.75}>
      <TextField
        autoFocus
        error={error}
        fullWidth
        helperText={error ? 'コメントを入力してください' : undefined}
        label={label}
        multiline
        minRows={2}
        onChange={(event) => onChange(event.target.value)}
        slotProps={{ htmlInput: { 'aria-label': label } }}
        value={value}
        sx={{ '& .MuiInputBase-root': { fontSize: 'body2.fontSize', lineHeight: 1.6, p: 1 } }}
      />
      <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end' }}>
        <Button aria-label="編集をキャンセル" onClick={onCancel} size="small" sx={{ fontSize: 'caption.fontSize', minWidth: 0, px: 0.8 }}>キャンセル</Button>
        <Button aria-label="編集を保存" disabled={!value.trim()} onClick={onSave} size="small" sx={{ fontSize: 'caption.fontSize', minWidth: 0, px: 0.8 }} variant="contained">保存</Button>
      </Stack>
    </Stack>
  )
}

function getPositionLabel(position: MockCommentPosition | undefined, file: string | undefined, line: number | undefined) {
  if (position) {
    const lineLabel = position.line === undefined
      ? ''
      : position.endLine && position.endLine !== position.line
        ? `:${position.line}-${position.endLine}`
        : `:${position.line}`
    const scopeLabel = position.scope === 'commit' ? 'コミット' : 'MR全体'
    return `${position.path}${lineLabel} · ${position.line === undefined ? 'ファイル全体' : position.side === 'old' ? '変更前' : '変更後'} · ${position.sha} · ${scopeLabel}`
  }
  if (file) return `${file}${line === undefined ? '' : `:${line}`}`
  return undefined
}
