import CheckRoundedIcon from '@mui/icons-material/CheckRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import ReplyRoundedIcon from '@mui/icons-material/ReplyRounded'
import UndoRoundedIcon from '@mui/icons-material/UndoRounded'
import Button from '@mui/material/Button'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useEffect, useState } from 'react'

import { MockMarkdown } from '../../components/mock/MockMarkdown'
import type { Discussion, Note } from '../../types/gitlab'
import { useAutoUpdateSafety } from '../shared/AutoUpdateSafety'

interface DiscussionListProps {
  currentUserId: string
  discussions: Discussion[]
  disabled?: boolean
  onDelete: (note: Note) => Promise<boolean>
  onEdit: (note: Note, body: string) => Promise<boolean>
  onReply: (discussion: Discussion) => void
  onResolve: (discussion: Discussion, resolved: boolean) => Promise<boolean>
}

export function DiscussionList({ currentUserId, discussions, disabled = false, onDelete, onEdit, onReply, onResolve }: DiscussionListProps) {
  const [editing, setEditing] = useState<{ note: Note; body: string } | null>(null)
  const { setUnsafe } = useAutoUpdateSafety('note-edit')
  useEffect(() => {
    setUnsafe(Boolean(editing))
  }, [editing, setUnsafe])

  return (
    <Stack spacing={1.25}>
      {discussions.map((discussion) => {
        const canResolve = discussion.notes.some((note) => note.resolvable)
        const resolved = canResolve && discussion.notes.filter((note) => note.resolvable).every((note) => note.resolved)
        return (
          <Paper component="article" key={discussion.id} sx={{ overflow: 'hidden' }} variant="outlined">
            <List disablePadding>
              {discussion.notes.map((note, index) => (
                <ListItem key={note.id} sx={{ alignItems: 'flex-start', display: 'block', px: 1.5, py: 1.25 }}>
                  <Stack spacing={0.8}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                      <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', minWidth: 0 }}>
                        <Typography sx={{ fontWeight: 700 }} variant="body2">{note.author.name}</Typography>
                        <Typography color="text.secondary" variant="caption">@{note.author.username}</Typography>
                        {note.author.id === currentUserId ? <Typography color="primary.main" variant="caption">自分</Typography> : null}
                        {note.system ? <Typography color="text.secondary" variant="caption">システム</Typography> : null}
                      </Stack>
                      <Typography color="text.secondary" variant="caption">{formatDate(note.createdAt)}</Typography>
                    </Stack>
                    {editing?.note.id === note.id ? (
                      <Stack spacing={0.75}>
                        <TextField autoFocus disabled={disabled} fullWidth label="コメントを編集" multiline minRows={2} onChange={(event) => setEditing({ body: event.target.value, note })} value={editing.body} />
                        <Stack direction="row" spacing={0.75} sx={{ justifyContent: 'flex-end' }}>
                          <Button onClick={() => setEditing(null)} size="small">取消</Button>
                          <Button disabled={!editing.body.trim() || disabled} onClick={() => void onEdit(note, editing.body.trim()).then((success) => { if (success) setEditing(null) })} size="small" variant="contained">保存</Button>
                        </Stack>
                      </Stack>
                    ) : <MockMarkdown body={note.body} />}
                    {note.position ? <Typography color="text.secondary" variant="caption">{note.position.newPath}:{note.position.newLine ?? note.position.oldLine ?? 'file'}</Typography> : null}
                    {note.author.id === currentUserId && !note.system ? (
                      <Stack direction="row" spacing={0.25} sx={{ alignItems: 'center', justifyContent: 'flex-end' }}>
                        <Tooltip title="コメントを編集"><IconButton aria-label={`${note.id}を編集`} disabled={disabled} onClick={() => setEditing({ body: note.body, note })} size="small"><EditOutlinedIcon fontSize="small" /></IconButton></Tooltip>
                        <Tooltip title="コメントを削除"><IconButton aria-label={`${note.id}を削除`} disabled={disabled} onClick={() => { if (globalThis.confirm('このコメントを削除しますか？')) void onDelete(note) }} size="small"><DeleteOutlineRoundedIcon fontSize="small" /></IconButton></Tooltip>
                      </Stack>
                    ) : null}
                    {index < discussion.notes.length - 1 ? <Divider sx={{ mt: 0.5 }} /> : null}
                  </Stack>
                </ListItem>
              ))}
            </List>
            <Divider />
            <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', px: 1, py: 0.5 }}>
              <Button disabled={disabled} onClick={() => onReply(discussion)} size="small" startIcon={<ReplyRoundedIcon />}>返信</Button>
              {canResolve ? <Button disabled={disabled} onClick={() => void onResolve(discussion, !resolved)} size="small" startIcon={resolved ? <UndoRoundedIcon /> : <CheckRoundedIcon />}>{resolved ? '再開' : '解決'}</Button> : null}
              <BoxSpacer />
            </Stack>
          </Paper>
        )
      })}
      {discussions.length === 0 ? <Paper sx={{ p: 3, textAlign: 'center' }} variant="outlined"><Typography color="text.secondary" variant="body2">議論はありません。最初のコメントを追加できます。</Typography></Paper> : null}
    </Stack>
  )
}

function BoxSpacer() {
  return <span style={{ flex: 1 }} />
}

function formatDate(value: string): string {
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? value : new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp)
}
