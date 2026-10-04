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

const DISCUSSIONS_PER_PAGE = 20
const NOTES_PER_PAGE = 50

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
  const [discussionPage, setDiscussionPage] = useState(1)
  const [notePages, setNotePages] = useState<Record<string, number>>({})
  const { setUnsafe } = useAutoUpdateSafety('note-edit')
  const discussionPageCount = pageCount(discussions.length, DISCUSSIONS_PER_PAGE)
  const editingDiscussionIndex = editing ? discussions.findIndex((discussion) => discussion.notes.some((note) => note.id === editing.note.id)) : -1
  const boundedDiscussionPage = editingDiscussionIndex >= 0
    ? Math.floor(editingDiscussionIndex / DISCUSSIONS_PER_PAGE) + 1
    : clampPage(discussionPage, discussionPageCount)
  const discussionStart = (boundedDiscussionPage - 1) * DISCUSSIONS_PER_PAGE
  const visibleDiscussions = discussions.slice(discussionStart, discussionStart + DISCUSSIONS_PER_PAGE)
  const paginationDisabled = Boolean(editing)

  useEffect(() => {
    setUnsafe(Boolean(editing))
  }, [editing, setUnsafe])

  return (
    <Stack spacing={1.25}>
      {visibleDiscussions.map((discussion) => {
        const canResolve = discussion.notes.some((note) => note.resolvable)
        const resolved = canResolve && discussion.notes.filter((note) => note.resolvable).every((note) => note.resolved)
        const notePageCount = pageCount(discussion.notes.length, NOTES_PER_PAGE)
        const editingNoteIndex = editing?.note.id ? discussion.notes.findIndex((note) => note.id === editing.note.id) : -1
        const requestedNotePage = notePages[discussion.id] ?? 1
        const notePage = editingNoteIndex >= 0
          ? Math.floor(editingNoteIndex / NOTES_PER_PAGE) + 1
          : clampPage(requestedNotePage, notePageCount)
        const noteStart = (notePage - 1) * NOTES_PER_PAGE
        const visibleNotes = discussion.notes.slice(noteStart, noteStart + NOTES_PER_PAGE)
        return (
          <Paper component="article" key={discussion.id} sx={{ overflow: 'hidden' }} variant="outlined">
            <List disablePadding>
              {visibleNotes.map((note, index) => (
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
                          <Button disabled={!editing.body.trim() || disabled} onClick={() => void onEdit(note, editing.body.trim()).then((success) => { if (success) setEditing(null) }).catch(() => undefined)} size="small" variant="contained">保存</Button>
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
                    {index < visibleNotes.length - 1 ? <Divider sx={{ mt: 0.5 }} /> : null}
                  </Stack>
                </ListItem>
              ))}
            </List>
            <Divider />
            {discussion.notes.length > 0 ? (
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'center', px: 1, py: 0.75 }}>
                {notePageCount > 1 ? <Button aria-label={`${discussion.id}の前のノートページ`} disabled={disabled || paginationDisabled || notePage <= 1} onClick={() => setNotePages((current) => ({ ...current, [discussion.id]: notePage - 1 }))} size="small">前へ</Button> : null}
                <Typography color="text.secondary" variant="caption">ノート {noteRangeStart(notePage, NOTES_PER_PAGE)}–{noteRangeEnd(notePage, NOTES_PER_PAGE, discussion.notes.length)} / {discussion.notes.length}</Typography>
                {notePageCount > 1 ? <Button aria-label={`${discussion.id}の次のノートページ`} disabled={disabled || paginationDisabled || notePage >= notePageCount} onClick={() => setNotePages((current) => ({ ...current, [discussion.id]: notePage + 1 }))} size="small">次へ</Button> : null}
              </Stack>
            ) : null}
            <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', px: 1, py: 0.5 }}>
              <Button disabled={disabled} onClick={() => onReply(discussion)} size="small" startIcon={<ReplyRoundedIcon />}>返信</Button>
              {canResolve ? <Button disabled={disabled} onClick={() => void onResolve(discussion, !resolved)} size="small" startIcon={resolved ? <UndoRoundedIcon /> : <CheckRoundedIcon />}>{resolved ? '再開' : '解決'}</Button> : null}
              {canResolve ? <Typography color="text.secondary" variant="caption">{resolved ? '解決済み' : '未解決'}</Typography> : null}
              <BoxSpacer />
            </Stack>
          </Paper>
        )
      })}
      {discussions.length > 0 ? (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'center' }}>
          <Button aria-label="前の議論ページ" disabled={disabled || paginationDisabled || boundedDiscussionPage <= 1} onClick={() => setDiscussionPage((current) => clampPage(current - 1, discussionPageCount))} size="small">前へ</Button>
          <Typography color="text.secondary" variant="caption">議論 {noteRangeStart(boundedDiscussionPage, DISCUSSIONS_PER_PAGE)}–{noteRangeEnd(boundedDiscussionPage, DISCUSSIONS_PER_PAGE, discussions.length)} / {discussions.length}</Typography>
          <Button aria-label="次の議論ページ" disabled={disabled || paginationDisabled || boundedDiscussionPage >= discussionPageCount} onClick={() => setDiscussionPage((current) => clampPage(current + 1, discussionPageCount))} size="small">次へ</Button>
        </Stack>
      ) : null}
      {discussions.length === 0 ? <Paper sx={{ p: 3, textAlign: 'center' }} variant="outlined"><Typography color="text.secondary" variant="body2">議論はありません。最初のコメントを追加できます。</Typography></Paper> : null}
    </Stack>
  )
}

function BoxSpacer() {
  return <span style={{ flex: 1 }} />
}

function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize))
}

function clampPage(page: number, totalPages: number): number {
  return Math.min(Math.max(page, 1), totalPages)
}

function noteRangeStart(page: number, pageSize: number): number {
  return (page - 1) * pageSize + 1
}

function noteRangeEnd(page: number, pageSize: number, total: number): number {
  return Math.min(page * pageSize, total)
}

function formatDate(value: string): string {
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? value : new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp)
}
