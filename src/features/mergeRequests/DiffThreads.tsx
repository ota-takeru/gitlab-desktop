import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useState } from 'react'

import { MockMarkdown } from '../../components/mock/MockMarkdown'
import { RelativeTime } from '../../components/RelativeTime'
import type { Discussion, Draft, Position } from '../../types/gitlab'
import type { ParsedLine } from './diffParser'
import { lineKey } from './diffLineThreads'

/**
 * What the diff shows under its lines, as on GitLab: line comment threads,
 * unpublished line comments of the pending review and the editor of a new one.
 */

export interface ThreadActions {
  disabled: boolean
  /** The thread being replied to, and its editor. */
  replyDiscussionId: string | null
  replyComposer: React.ReactNode
  onReply: (discussion: Discussion) => void
  onResolve: (discussion: Discussion, resolved: boolean) => void
}

export interface ThreadView {
  threads: Map<string, Discussion[]>
  onOpen?: (discussionId: string) => void
  composer?: { key: string | null; node: React.ReactNode; position: Position }
  drafts?: Map<string, Draft[]>
  actions?: ThreadActions
}

export function LineThreads({ line, view }: { line?: ParsedLine; view?: ThreadView }) {
  const key = line && view ? lineKey(line) : null
  const threads = key ? view?.threads.get(key) ?? [] : []
  const drafts = key ? view?.drafts?.get(key) ?? [] : []
  const composer = key && line && view?.composer?.key === key && (view.composer.position.newPath === line.newPath || view.composer.position.oldPath === line.oldPath) ? view.composer.node : null
  if (!threads.length && !drafts.length && !composer) return null
  return <Box className="diff-threads" sx={{ bgcolor: 'surface.list', borderBottom: 1, borderTop: 1, borderColor: 'divider', fontFamily: 'typography.fontFamily', lineHeight: 'normal', px: 1.5, py: 1, whiteSpace: 'normal' }}>
    <Stack spacing={1} sx={{ maxWidth: 900 }}>
      {threads.map((discussion) => <DiffThread actions={view?.actions} discussion={discussion} key={discussion.id} onOpen={view?.onOpen} />)}
      {drafts.map((draft) => <Box aria-label="未公開のコメント" component="article" key={draft.id} sx={{ bgcolor: 'surface.raised', border: 1, borderColor: 'warning.main', borderRadius: 1, borderStyle: 'dashed', px: 1.25, py: 0.75 }}>
        <Chip color="warning" label="未公開レビュー" size="small" variant="outlined" />
        <MockMarkdown body={draft.body} />
      </Box>)}
      {composer}
    </Stack>
  </Box>
}

function DiffThread({ actions, discussion, onOpen }: { actions?: ThreadActions; discussion: Discussion; onOpen?: (discussionId: string) => void }) {
  const notes = discussion.notes.filter((note) => !note.system)
  const resolvable = notes.filter((note) => note.resolvable)
  const resolved = resolvable.length > 0 && resolvable.every((note) => note.resolved)
  // Only resolved threads fold; one being replied to stays open.
  const [openedResolved, setExpanded] = useState(false)
  const replying = actions?.replyDiscussionId === discussion.id
  const expanded = !resolved || openedResolved || replying
  return <Box aria-label={`${notes[0]?.author.name ?? ''}のスレッド`} component="article" data-diff-thread={discussion.id} sx={{ bgcolor: 'surface.raised', border: 1, borderColor: resolved ? 'divider' : 'surface.borderStrong', borderRadius: 1, overflow: 'hidden' }}>
    {expanded ? <Stack divider={<Box sx={{ borderTop: 1, borderColor: 'divider' }} />}>
      {notes.map((note) => <Box key={note.id} sx={{ px: 1.25, py: 0.75 }}>
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'baseline' }}>
          <Typography sx={{ fontWeight: 600 }} variant="body2">{note.author.name}</Typography>
          <RelativeTime value={note.createdAt} />
        </Stack>
        <MockMarkdown body={note.body} />
      </Box>)}
    </Stack> : null}
    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', bgcolor: 'action.hover', borderTop: expanded ? 1 : 0, borderColor: 'divider', px: 1, py: 0.25 }}>
      {resolved ? <Chip label="解決済み" size="small" variant="outlined" /> : null}
      {!expanded ? <Typography color="text.secondary" noWrap sx={{ flex: 1, minWidth: 0 }} variant="caption">{notes[0]?.author.name} ほか{notes.length}件のコメント</Typography> : <Box sx={{ flex: 1 }} />}
      {resolved && !replying ? <Button onClick={() => setExpanded(!expanded)} size="small">{expanded ? '折りたたむ' : '表示'}</Button> : null}
      {actions && !replying ? <Button disabled={actions.disabled} onClick={() => actions.onReply(discussion)} size="small">返信</Button> : null}
      {actions && resolvable.length > 0 ? <Button disabled={actions.disabled} onClick={() => actions.onResolve(discussion, !resolved)} size="small">{resolved ? '未解決に戻す' : '解決する'}</Button> : null}
      {onOpen ? <Button onClick={() => onOpen(discussion.id)} size="small">{actions ? '議論タブで表示' : '議論で返信・解決'}</Button> : null}
    </Stack>
    {replying ? <Box sx={{ borderTop: 1, borderColor: 'divider', px: 1, py: 0.75 }}>{actions?.replyComposer}</Box> : null}
  </Box>
}
