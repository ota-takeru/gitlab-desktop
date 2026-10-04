import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined'
import SendOutlinedIcon from '@mui/icons-material/SendOutlined'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import FormControlLabel from '@mui/material/FormControlLabel'
import IconButton from '@mui/material/IconButton'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useState } from 'react'

import type { MockPendingComment } from '../../mock/reviewTypes'
import { MockMarkdown } from './MockMarkdown'

export interface MockPendingReviewProps {
  pending: MockPendingComment[]
  onEdit: (id: string, body: string) => void
  onDelete: (id: string) => void
  onDiscard: () => void
  onPublish: (summary: string, approve: boolean) => void
}

function positionLabel(position: MockPendingComment['position']) {
  if (!position) return undefined
  const line = position.line === undefined
    ? 'ファイル全体'
    : position.endLine && position.endLine !== position.line ? `${position.line}–${position.endLine}` : position.line
  const side = position.side === 'new' ? '変更後' : '変更前'
  return `${position.path}:${line} · ${side} · ${position.sha.slice(0, 8)}`
}

function targetLabel(item: MockPendingComment) {
  if (item.position) return positionLabel(item.position)
  if (item.replyTo) return `返信: ${item.replyAuthor ?? item.replyTo}`
  return 'MR全体へのコメント'
}

export function MockPendingReview({ pending, onEdit, onDelete, onDiscard, onPublish }: MockPendingReviewProps) {
  const [open, setOpen] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [editingId, setEditingId] = useState<string>()
  const [editingBody, setEditingBody] = useState('')
  const [summary, setSummary] = useState('')
  const [approve, setApprove] = useState(false)

  const startEdit = (item: MockPendingComment) => {
    setEditingId(item.id)
    setEditingBody(item.body)
  }

  const saveEdit = () => {
    if (!editingId || !editingBody.trim()) return
    onEdit(editingId, editingBody)
    setEditingId(undefined)
  }

  const deletePending = (id: string) => {
    if (editingId === id) {
      setEditingId(undefined)
      setEditingBody('')
    }
    onDelete(id)
  }

  const closeDialog = () => {
    setOpen(false)
    setEditingId(undefined)
  }

  const publish = () => {
    onPublish(summary.trim(), approve)
    setSummary('')
    setApprove(false)
    closeDialog()
  }

  const discard = () => {
    onDiscard()
    setSummary('')
    setApprove(false)
    setEditingId(undefined)
    setEditingBody('')
    setDiscardOpen(false)
    closeDialog()
  }

  return (
    <>
      <Button aria-label={`レビューを送信 (${pending.length})`} disabled={!pending.length} onClick={() => setOpen(true)} size="small" startIcon={<HistoryOutlinedIcon />} sx={{ fontSize: 'caption.fontSize', minWidth: 0, px: 1 }} variant="contained">
        レビューを送信 ({pending.length})
      </Button>

      <Dialog fullWidth maxWidth="sm" onClose={closeDialog} open={open}>
        <DialogTitle sx={{ pb: 1 }}>レビューを送信 ({pending.length})</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.25}>
            <Typography color="text.secondary" sx={{ fontSize: 'caption.fontSize' }}>
              保留中のコメントをまとめて確認してから送信するモックです。GitLabへは送信されません。
            </Typography>
            {pending.map((item, index) => {
              const target = targetLabel(item) ?? 'MR全体へのコメント'
              return (
              <Paper key={item.id} variant="outlined" sx={{ bgcolor: 'background.default', p: 1 }}>
                <Stack spacing={0.7}>
                  <Stack direction="row" spacing={0.6} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                    <Stack direction="row" spacing={0.6} sx={{ alignItems: 'center', minWidth: 0 }}>
                      <Chip label={item.kind === 'thread' ? 'スレッド' : 'コメント'} size="small" sx={{ fontSize: 'caption.fontSize', height: 22 }} variant="outlined" />
                      <Typography color="text.secondary" component="code" title={target} variant="code" sx={{ fontSize: 'caption.fontSize', maxWidth: '100%', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
                        {target}
                      </Typography>
                    </Stack>
                    <Stack direction="row" spacing={0.25} sx={{ flexShrink: 0 }}>
                      <IconButton aria-label={`未公開コメント${index + 1}（${target}）を編集`} onClick={() => startEdit(item)} size="small" title={`${target}を編集`}><EditOutlinedIcon sx={{ fontSize: 17 }} /></IconButton>
                      <IconButton aria-label={`未公開コメント${index + 1}（${target}）を削除`} onClick={() => deletePending(item.id)} size="small" title={`${target}を削除`}><DeleteOutlineOutlinedIcon sx={{ fontSize: 17 }} /></IconButton>
                    </Stack>
                  </Stack>
                  {item.resolution ? <Typography color={item.resolution === 'resolved' ? 'success.main' : 'warning.main'} sx={{ fontSize: 'caption.fontSize' }}>{item.resolution === 'resolved' ? '投稿時に解決' : '投稿時に再開'}</Typography> : null}
                  {editingId === item.id ? (
                    <Stack spacing={0.6}>
                      <TextField autoFocus fullWidth label="コメントを編集" minRows={2} multiline onChange={(event) => setEditingBody(event.target.value)} value={editingBody} />
                      <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end' }}>
                        <Button onClick={() => setEditingId(undefined)} size="small" sx={{ fontSize: 'caption.fontSize' }}>キャンセル</Button>
                        <Button disabled={!editingBody.trim()} onClick={saveEdit} size="small" sx={{ fontSize: 'caption.fontSize' }} variant="outlined">保存</Button>
                      </Stack>
                    </Stack>
                  ) : <MockMarkdown body={item.body} />}
                </Stack>
              </Paper>
              )
            })}
            <Divider />
            <TextField fullWidth label="レビュー概要（任意）" minRows={2} multiline onChange={(event) => setSummary(event.target.value)} placeholder="今回のレビューについて一言…" value={summary} />
            <FormControlLabel
              control={<Checkbox checked={approve} onChange={(event) => setApprove(event.target.checked)} size="small" />}
              label="このレビューを承認として送信"
              sx={{ '& .MuiFormControlLabel-label': { fontSize: 'body2.fontSize' }, m: 0 }}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 2, py: 1 }}>
          <Button color="error" onClick={() => setDiscardOpen(true)} size="small" sx={{ fontSize: 'caption.fontSize', mr: 'auto' }}>レビューを破棄</Button>
          <Button onClick={closeDialog} size="small" sx={{ fontSize: 'caption.fontSize' }}>戻る</Button>
          <Button disabled={!pending.length || Boolean(editingId)} onClick={publish} size="small" startIcon={<SendOutlinedIcon />} sx={{ fontSize: 'caption.fontSize' }} variant="contained">レビューを送信シミュレーション</Button>
        </DialogActions>
      </Dialog>

      <Dialog fullWidth maxWidth="xs" onClose={() => setDiscardOpen(false)} open={discardOpen}>
        <DialogTitle>レビューを破棄しますか？</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ fontSize: 'body2.fontSize' }}>保留中のコメント {pending.length}件とレビュー概要を破棄します。この操作はモック内でのみ行われます。</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDiscardOpen(false)} size="small">キャンセル</Button>
          <Button color="error" onClick={discard} size="small" variant="contained">破棄する</Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
