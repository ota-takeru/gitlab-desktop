import ChatBubbleOutlineRoundedIcon from '@mui/icons-material/ChatBubbleOutlineRounded'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined'
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined'
import RadioButtonUncheckedRoundedIcon from '@mui/icons-material/RadioButtonUncheckedRounded'
import Box from '@mui/material/Box'
import ListItemButton from '@mui/material/ListItemButton'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'

import { hairline, panelFrame } from '../../components/hairline'
import { Row } from '../../components/Row'
import { alignTop, firstLine } from '../../components/rows'
import { useT } from '../../i18n/useT'
import type { Discussion, Note } from '../../types/gitlab'
import { findScrollContainer } from './discussionScroll'
import { isUnresolvedDiscussion } from './discussionStatus'
import { plainExcerpt } from './discussionText'
import type { DiscussionFilter } from './DiscussionList'

interface OutlineThread {
  id: string
  first: Note
  replies: number
  unread: number
  status: 'unresolved' | 'resolved' | 'comment'
  line: number | null
}

interface OutlineGroup {
  /** The file's path; empty for comments on the whole MR. */
  path: string
  threads: OutlineThread[]
}

/**
 * Table of contents of the threads the discussion list shows, grouped by file in the order the files first appear.
 * The thread in view is marked, and choosing one scrolls the list to it.
 */
export function ThreadOutline({ discussions, filter, olderNotLoaded, onSelect, unreadNoteIds }: { discussions: Discussion[]; filter: DiscussionFilter; olderNotLoaded: boolean; onSelect: (discussionId: string) => void; unreadNoteIds: string[] }) {
  const t = useT()
  const navRef = useRef<HTMLElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const { groups, total, unresolved } = useMemo(() => outline(discussions, filter, new Set(unreadNoteIds)), [discussions, filter, unreadNoteIds])
  const shownIds = groups.flatMap((group) => group.threads.map((thread) => thread.id)).join('\n')
  const active = useThreadInView(navRef, shownIds)

  // The marked thread stays in view in the outline, below the file heading kept at its top.
  useEffect(() => {
    const list = listRef.current
    const row = active && list ? list.querySelector<HTMLElement>(`[data-outline-id="${CSS.escape(active)}"]`) : null
    if (!list || !row) return
    const listBox = list.getBoundingClientRect()
    const rowBox = row.getBoundingClientRect()
    const heading = row.closest('[data-outline-group]')?.querySelector<HTMLElement>('[data-outline-heading]')?.offsetHeight ?? 0
    if (rowBox.top < listBox.top + heading) list.scrollTop -= listBox.top + heading - rowBox.top
    else if (rowBox.bottom > listBox.bottom) list.scrollTop += rowBox.bottom - listBox.bottom
  }, [active])

  return (
    <Stack aria-label={t('review.outline.title')} component="nav" ref={navRef} sx={{ bgcolor: 'surface.raised', ...panelFrame(), borderRadius: 1, minWidth: 0 }}>
      <Row sx={{ ...hairline('bottom'), px: 1.5, py: 0.5 }}>
        <Typography color="textSecondary" variant="overline">{t('review.outline.title')}</Typography>
        <Typography color="textSecondary" sx={{ ml: 'auto' }} variant="caption">{t('review.outline.summary', { total, unresolved })}</Typography>
      </Row>
      {groups.length === 0 ? <Typography color="textSecondary" sx={{ px: 1.5, py: 1 }} variant="caption">{filter === 'unresolved' ? t('review.outline.noneUnresolved') : t('review.outline.none')}</Typography> : (
        <Box ref={listRef} sx={{ maxHeight: 'min(60vh, 640px)', overflowY: 'auto', pb: 0.5 }}>
          {groups.map((group) => (
            <Box data-outline-group key={group.path} role="group" aria-label={group.path || t('review.outline.overview')}>
              <GroupHeading path={group.path} />
              {group.threads.map((thread) => <OutlineRow active={thread.id === active} key={thread.id} onSelect={onSelect} thread={thread} />)}
            </Box>
          ))}
        </Box>
      )}
      {olderNotLoaded ? <Typography color="textSecondary" sx={{ ...hairline('top'), px: 1.5, py: 0.5 }} variant="caption">{t('review.outline.olderNotLoaded')}</Typography> : null}
    </Stack>
  )
}

function GroupHeading({ path }: { path: string }) {
  const t = useT()
  const slash = path.lastIndexOf('/')
  return (
    <Row data-outline-heading spacing={0.5} sx={{ bgcolor: 'surface.raised', minWidth: 0, position: 'sticky', pt: 1, pb: 0.25, px: 1.5, top: 0, zIndex: 1 }}>
      {path ? <InsertDriveFileOutlinedIcon sx={{ color: 'text.secondary', flexShrink: 0, fontSize: 14 }} /> : <ForumOutlinedIcon sx={{ color: 'text.secondary', flexShrink: 0, fontSize: 14 }} />}
      {path ? (
        <Tooltip placement="left" title={path}>
          <Row spacing={0.5} sx={{ minWidth: 0 }}>
            <Typography noWrap sx={{ flexShrink: 0, fontFamily: 'code.fontFamily', fontWeight: 600, maxWidth: '100%' }} variant="caption">{path.slice(slash + 1)}</Typography>
            {/* The folder gives way first, keeping its end (the part nearest the file) in view. */}
            {slash > 0 ? <Typography color="textSecondary" noWrap sx={{ direction: 'rtl', fontFamily: 'code.fontFamily', minWidth: 0, textAlign: 'left' }} variant="caption"><bdi>{path.slice(0, slash)}</bdi></Typography> : null}
          </Row>
        </Tooltip>
      ) : <Typography sx={{ fontWeight: 600 }} variant="caption">{t('review.outline.overview')}</Typography>}
    </Row>
  )
}

function OutlineRow({ active, onSelect, thread }: { active: boolean; onSelect: (discussionId: string) => void; thread: OutlineThread }) {
  const t = useT()
  const statusLabel = t(`review.outline.status.${thread.status}`)
  const details = [
    thread.line !== null ? `L${thread.line}` : null,
    thread.first.author.name,
    thread.replies > 0 ? t('review.outline.replies', { count: thread.replies }) : null,
  ].filter(Boolean).join(' · ')
  return (
    <ListItemButton
      aria-current={active ? 'location' : undefined}
      data-outline-id={thread.id}
      onClick={() => onSelect(thread.id)}
      selected={active}
      sx={{ ...alignTop, columnGap: 1, pl: 1.5, pr: 1, py: 0.5, position: 'relative', '&.Mui-selected::before': { bgcolor: 'primary.main', bottom: 4, content: '""', left: 0, position: 'absolute', top: 4, width: 3 } }}
    >
      <Tooltip title={statusLabel}>
        <Box aria-label={statusLabel} component="span" role="img" sx={firstLine('body2')}>
          {thread.status === 'unresolved' ? <RadioButtonUncheckedRoundedIcon color="warning" sx={{ fontSize: 14 }} />
            : thread.status === 'resolved' ? <CheckCircleRoundedIcon color="success" sx={{ fontSize: 14 }} />
              : <ChatBubbleOutlineRoundedIcon sx={{ color: 'text.secondary', fontSize: 14 }} />}
        </Box>
      </Tooltip>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography color={thread.status === 'resolved' ? 'textSecondary' : 'textPrimary'} noWrap variant="body2">{plainExcerpt(thread.first.body, 120)}</Typography>
        <Typography color="textSecondary" component="div" noWrap variant="caption">{details}</Typography>
      </Box>
      {thread.unread > 0 ? (
        <Box sx={firstLine('body2')}>
          <Typography aria-label={t('review.outline.unread', { count: thread.unread })} component="span" role="img" sx={{ alignItems: 'center', bgcolor: 'primary.main', borderRadius: 2, color: 'primary.contrastText', display: 'inline-flex', fontWeight: 600, height: 16, justifyContent: 'center', minWidth: 16, px: 0.5 }} variant="caption">{thread.unread}</Typography>
        </Box>
      ) : null}
    </ListItemButton>
  )
}

function outline(discussions: Discussion[], filter: DiscussionFilter, unreadIds: Set<string>): { groups: OutlineGroup[]; total: number; unresolved: number } {
  const groups = new Map<string, OutlineThread[]>()
  let total = 0
  let unresolved = 0
  for (const discussion of discussions) {
    const notes = discussion.notes.filter((note) => !note.system)
    if (!notes.length) continue
    total += 1
    const isUnresolved = isUnresolvedDiscussion(discussion)
    if (isUnresolved) unresolved += 1
    if (filter === 'unresolved' && !isUnresolved) continue
    const position = notes.find((note) => note.position)?.position ?? null
    const path = position ? position.newPath || position.oldPath : ''
    const thread: OutlineThread = {
      id: discussion.id,
      first: notes[0],
      line: position ? position.newLine ?? position.oldLine ?? null : null,
      replies: notes.length - 1,
      status: isUnresolved ? 'unresolved' : notes.some((note) => note.resolvable) ? 'resolved' : 'comment',
      unread: notes.filter((note) => unreadIds.has(note.id)).length,
    }
    const group = groups.get(path)
    if (group) group.push(thread)
    else groups.set(path, [thread])
  }
  return { groups: Array.from(groups, ([path, threads]) => ({ path, threads })), total, unresolved }
}

/**
 * The first thread of the discussion list in the upper half of the view, below the sticky MR header.
 * `key` changes when other threads are shown, so the new ones are watched.
 */
function useThreadInView(anchor: RefObject<HTMLElement | null>, key: string): string | null {
  const [active, setActive] = useState<string | null>(null)
  useEffect(() => {
    const layout = anchor.current?.closest('[data-discussion-layout]')
    if (!layout || typeof IntersectionObserver === 'undefined') return
    const threads = Array.from(layout.querySelectorAll<HTMLElement>('[data-discussion-id]'))
    if (!threads.length) return
    const header = Number.parseFloat(getComputedStyle(threads[0]).getPropertyValue('--detail-header-height')) || 0
    const visible = new Set<Element>()
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target)
        else visible.delete(entry.target)
      }
      const first = threads.find((thread) => visible.has(thread))
      if (first) setActive(first.dataset.discussionId ?? null)
    }, { root: findScrollContainer(threads[0]), rootMargin: `-${header}px 0px -50% 0px` })
    for (const thread of threads) observer.observe(thread)
    return () => observer.disconnect()
  }, [anchor, key])
  return active
}
