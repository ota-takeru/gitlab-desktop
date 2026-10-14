import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useState } from 'react'

import { MockMarkdown } from '../../components/mock/MockMarkdown'
import { RelativeTime } from '../../components/RelativeTime'
import { ResolveToggle } from '../../components/ResolveToggle'
import type { Discussion, Draft, Position } from '../../types/gitlab'
import { GitLabUserAvatar } from '../shared/GitLabUserAvatar'
import type { ParsedLine } from './diffParser'
import { lineKey } from './diffLineThreads'
import { plainExcerpt } from './discussionText'

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
  /** Session used to load GitLab avatars; initials are shown without it. */
  sessionId?: string | null
}

export function LineThreads({ line, view }: { line?: ParsedLine; view?: ThreadView }) {
  const key = line && view ? lineKey(line) : null
  const threads = key ? view?.threads.get(key) ?? [] : []
  const drafts = key ? view?.drafts?.get(key) ?? [] : []
  const composer = key && line && view?.composer?.key === key && (view.composer.position.newPath === line.newPath || view.composer.position.oldPath === line.oldPath) ? view.composer.node : null
  if (!threads.length && !drafts.length && !composer) return null
  return <Box className="diff-threads" sx={{ bgcolor: 'surface.list', borderBottom: 1, borderTop: 1, borderColor: 'divider', fontFamily: 'fontFamily', lineHeight: 'normal', px: 1.5, py: 1, whiteSpace: 'normal' }}>
    <Stack spacing={1} sx={{ maxWidth: 900 }}>
      {threads.map((discussion) => <DiffThread actions={view?.actions} discussion={discussion} key={discussion.id} onOpen={view?.onOpen} sessionId={view?.sessionId} />)}
      {drafts.map((draft) => <Box aria-label="未公開のコメント" component="article" key={draft.id} sx={{ bgcolor: 'surface.raised', border: 1, borderColor: 'warning.main', borderRadius: 1, borderStyle: 'dashed', px: 1.5, py: 1 }}>
        <Chip color="warning" label="未公開レビュー" size="small" variant="outlined" />
        <MockMarkdown body={draft.body} />
      </Box>)}
      {composer}
    </Stack>
  </Box>
}

function DiffThread({ actions, discussion, onOpen, sessionId }: { actions?: ThreadActions; discussion: Discussion; onOpen?: (discussionId: string) => void; sessionId?: string | null }) {
  const notes = discussion.notes.filter((note) => !note.system)
  const resolvable = notes.filter((note) => note.resolvable)
  const resolved = resolvable.length > 0 && resolvable.every((note) => note.resolved)
  // Only resolved threads fold; one being replied to stays open.
  const [openedResolved, setExpanded] = useState(false)
  const replying = actions?.replyDiscussionId === discussion.id
  const expanded = !resolved || openedResolved || replying
  // `clip` rather than `hidden`, so the reply editor's toolbar can stick while it scrolls.
  return <Box aria-label={`${notes[0]?.author.name ?? ''}のスレッド`} component="article" data-diff-thread={discussion.id} tabIndex={-1} sx={{ bgcolor: 'surface.raised', border: 1, borderColor: resolved ? 'divider' : 'surface.borderStrong', borderRadius: 1, overflow: 'clip', scrollMarginTop: 'calc(var(--detail-header-height, 0px) + var(--diff-file-header-height, 0px) + 8px)', '&:focus': { outline: 'none' }, '&:focus-visible': { boxShadow: (theme) => `inset 0 0 0 2px ${theme.palette.primary.main}` } }}>
    {expanded ? <Stack divider={<Box sx={{ borderTop: 1, borderColor: 'divider' }} />}>
      {notes.map((note) => <Box key={note.id} sx={{ columnGap: 1.5, display: 'grid', gridTemplateColumns: '28px minmax(0, 1fr)', px: 1.5, py: 1 }}>
        <Box sx={{ pt: 0.25 }}><GitLabUserAvatar sessionId={sessionId} user={note.author} /></Box>
        <Box sx={{ minWidth: 0 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', flexWrap: 'wrap', minHeight: 26, minWidth: 0, pt: 0.5, rowGap: 0 }}>
            <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }} variant="body2">{note.author.name}</Typography>
            <RelativeTime value={note.createdAt} />
          </Stack>
          <Box sx={{ color: 'text.primary', mt: 0.25 }}><MockMarkdown body={note.body} size="body1" /></Box>
        </Box>
      </Box>)}
    </Stack> : null}
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', bgcolor: 'action.hover', borderTop: expanded ? 1 : 0, borderColor: 'divider', px: 1, py: 0.25 }}>
      {actions && resolvable.length > 0 ? <ResolveToggle dense disabled={actions.disabled} onToggle={(resolve) => actions.onResolve(discussion, resolve)} resolved={resolved} /> : null}
      {!expanded ? <Typography color="textSecondary" noWrap sx={{ flex: 1, minWidth: 0 }} title={notes[0] ? plainExcerpt(notes[0].body, 200) : undefined} variant="caption">{notes[0]?.author.name}{notes.length > 1 ? ` ほか${notes.length - 1}件` : ''}のコメント</Typography> : <Box sx={{ flex: 1 }} />}
      {resolved && !replying ? <Button onClick={() => setExpanded(!expanded)} size="small" sx={barButtonSx}>{expanded ? '折りたたむ' : '表示'}</Button> : null}
      {actions && !replying ? <Button disabled={actions.disabled} onClick={() => actions.onReply(discussion)} size="small" sx={barButtonSx}>返信</Button> : null}
      {onOpen ? <Button onClick={() => onOpen(discussion.id)} size="small" sx={barButtonSx}>{actions ? '議論タブで表示' : '議論で返信・解決'}</Button> : null}
    </Stack>
    {replying ? <Box sx={{ borderTop: 1, borderColor: 'divider', px: 1, py: 1 }}>{actions?.replyComposer}</Box> : null}
  </Box>
}

/** The thread bar between code lines keeps its text buttons as compact as its toggle. */
const barButtonSx = { '&.MuiButton-sizeSmall': { fontSize: 'caption.fontSize', minHeight: 24, px: 1, py: 0 } } as const
