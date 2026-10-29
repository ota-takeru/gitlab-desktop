import ScheduleSendOutlinedIcon from '@mui/icons-material/ScheduleSendOutlined'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useState } from 'react'

import { edgeRow } from '../../components/edges'
import { frame, hairline, panelFrame } from '../../components/hairline'
import { gridLine } from '../../theme'
import { RelativeTime } from '../../components/RelativeTime'
import { ResolveToggle } from '../../components/ResolveToggle'
import { StateIcon } from '../../components/StateIcon'
import type { Discussion, Draft, Note, Position } from '../../types/gitlab'
import { GitLabUserAvatar } from '../shared/GitLabUserAvatar'
import type { ParsedLine } from './diffParser'
import { lineKey, positionLines } from './diffLineThreads'
import { plainExcerpt } from './discussionText'
import { NoteBody, type SuggestionActions } from './SuggestionBlock'
import { useT } from '../../i18n/useT'

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
  /** The emoji reactions shown under a comment. */
  renderReactions?: (note: Note) => React.ReactNode
}

export interface ThreadView {
  threads: Map<string, Discussion[]>
  onOpen?: (discussionId: string) => void
  composer?: { key: string | null; node: React.ReactNode; position: Position }
  drafts?: Map<string, Draft[]>
  actions?: ThreadActions
  /** Session used to load GitLab avatars; initials are shown without it. */
  sessionId?: string | null
  /** Applying the suggestions in the threads. */
  suggestionActions?: SuggestionActions
}

export function LineThreads({ line, view }: { line?: ParsedLine; view?: ThreadView }) {
  const t = useT()
  const key = line && view ? lineKey(line) : null
  // A line shown as unchanged because only its whitespace changed keeps the comments on its removed version too.
  const keys = key && line?.whitespaceOnly && line.oldLine != null ? [key, `o:${line.oldLine}`] : key ? [key] : []
  const threads = keys.flatMap((at) => view?.threads.get(at) ?? [])
  const drafts = keys.flatMap((at) => view?.drafts?.get(at) ?? [])
  const composer = key && line && view?.composer?.key === key && (view.composer.position.newPath === line.newPath || view.composer.position.oldPath === line.oldPath) ? view.composer.node : null
  if (!threads.length && !drafts.length && !composer) return null
  return <Box className="diff-threads" sx={{ bgcolor: 'surface.list', ...hairline(['top', 'bottom']), fontFamily: 'fontFamily', lineHeight: gridLine(5), px: 1.5, py: 1, whiteSpace: 'normal' }}>
    <Stack spacing={1} sx={{ maxWidth: 900 }}>
      {threads.map((discussion) => <DiffThread actions={view?.actions} discussion={discussion} key={discussion.id} onOpen={view?.onOpen} sessionId={view?.sessionId} suggestionActions={view?.suggestionActions} />)}
      {drafts.map((draft) => <Box aria-label={t('review.thread.draft')} component="article" key={draft.id} sx={{ bgcolor: 'surface.raised', ...frame({ color: 'warning.main' }), outlineStyle: 'dashed', borderRadius: 1, px: 1.5, py: 1 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <StateIcon icon={<ScheduleSendOutlinedIcon fontSize="inherit" />} label={t('review.thread.draftState')} tone="warning" />
          {draft.position?.lineRange ? <Typography color="textSecondary" variant="caption">{t('review.thread.lines', { lines: positionLines(draft.position) })}</Typography> : null}
        </Stack>
        <NoteBody note={{ body: draft.body }} size="body2" />
      </Box>)}
      {composer}
    </Stack>
  </Box>
}

function DiffThread({ actions, discussion, onOpen, sessionId, suggestionActions }: { actions?: ThreadActions; discussion: Discussion; onOpen?: (discussionId: string) => void; sessionId?: string | null; suggestionActions?: SuggestionActions }) {
  const t = useT()
  const notes = discussion.notes.filter((note) => !note.system)
  // A multi-line comment sits under its last line, as on GitLab, and names its lines.
  const position = notes.find((note) => note.position)?.position
  const rangeLabel = position?.lineRange ? t('review.thread.rangeLabel', { lines: positionLines(position) }) : null
  const resolvable = notes.filter((note) => note.resolvable)
  const resolved = resolvable.length > 0 && resolvable.every((note) => note.resolved)
  // Only resolved threads fold, and only when shown resolved or resolved here: one already open stays
  // open when someone else resolves it. One being replied to stays open.
  const [folded, setFolded] = useState(resolved)
  const replying = actions?.replyDiscussionId === discussion.id
  const expanded = !resolved || !folded || replying
  // `clip` rather than `hidden`, so the reply editor's toolbar can stick while it scrolls.
  return <Box aria-label={t('review.discussion.threadLabel', { author: notes[0]?.author.name ?? '' })} component="article" data-diff-thread={discussion.id} tabIndex={-1} sx={{ bgcolor: 'surface.raised', ...panelFrame({ color: resolved ? 'divider' : 'surface.borderStrong' }), borderRadius: 1, overflow: 'clip', scrollMarginTop: 'calc(var(--detail-header-height, 0px) + var(--diff-file-header-height, 0px) + 8px)', '&:focus-visible': { boxShadow: (theme) => `inset 0 0 0 2px ${theme.palette.primary.main}` } }}>
    {expanded ? <Stack divider={<Box sx={hairline('top')} />}>
      {notes.map((note) => <Box key={note.id} sx={{ columnGap: 1.5, display: 'grid', gridTemplateColumns: '28px minmax(0, 1fr)', px: 1.5, py: 1 }}>
        <Box sx={{ pt: 0.25 }}><GitLabUserAvatar sessionId={sessionId} user={note.author} /></Box>
        <Box sx={{ minWidth: 0 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', flexWrap: 'wrap', minHeight: 24, minWidth: 0, pt: 0.5, rowGap: 0 }}>
            <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }} variant="body2">{note.author.name}</Typography>
            <RelativeTime value={note.createdAt} />
          </Stack>
          <Box sx={{ color: 'text.primary', mt: 0.5 }}><NoteBody actions={suggestionActions} note={note} size="body1" /></Box>
          {actions?.renderReactions ? <Box sx={{ mt: 1 }}>{actions.renderReactions(note)}</Box> : null}
        </Box>
      </Box>)}
    </Stack> : null}
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', bgcolor: 'action.hover', ...(expanded ? hairline('top') : {}), px: 1, py: 0.25, ...edgeRow }}>
      {actions && resolvable.length > 0 ? <ResolveToggle dense disabled={actions.disabled} onToggle={(resolve) => { setFolded(resolve); actions.onResolve(discussion, resolve) }} resolved={resolved} /> : null}
      {!expanded ? <Typography color="textSecondary" noWrap sx={{ flex: 1, minWidth: 0 }} title={notes[0] ? plainExcerpt(notes[0].body, 200) : undefined} variant="caption">{rangeLabel ? `${rangeLabel} · ` : ''}{notes.length > 1 ? t('review.thread.summaryMore', { author: notes[0]?.author.name ?? '', count: notes.length - 1 }) : t('review.thread.summary', { author: notes[0]?.author.name ?? '' })}</Typography>
        : <Typography color="textSecondary" noWrap sx={{ flex: 1, minWidth: 0 }} variant="caption">{rangeLabel}</Typography>}
      {resolved && !replying ? <Button onClick={() => setFolded(expanded)} size="dense">{expanded ? t('review.discussion.collapse') : t('review.thread.show')}</Button> : null}
      {actions && !replying ? <Button disabled={actions.disabled} onClick={() => actions.onReply(discussion)} size="dense">{t('review.discussion.reply')}</Button> : null}
      {onOpen ? <Button onClick={() => onOpen(discussion.id)} size="dense">{actions ? t('review.thread.openInDiscussions') : t('review.thread.replyInDiscussions')}</Button> : null}
    </Stack>
    {replying ? <Box sx={{ ...hairline('top'), px: 1, py: 1 }}>{actions?.replyComposer}</Box> : null}
  </Box>
}

