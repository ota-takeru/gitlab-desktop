import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import OpenInFullRoundedIcon from '@mui/icons-material/OpenInFullRounded'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { MarkdownLinkProvider } from '../../components/MarkdownLinks'
import { MockMarkdown } from '../../components/mock/MockMarkdown'
import { projectUrlOf } from '../../lib/markdownLinks'
import { MergeRequestStateGlyph } from '../../components/MergeRequestStateIcon'
import { RelativeTime } from '../../components/RelativeTime'
import { StatusPill } from '../../components/StatusPill'
import { useT } from '../../i18n/useT'
import { formatMergeRequestState, mergeRequestStateTone } from '../../lib/format'
import type { MergeRequest } from '../../types/gitlab'
import { formatNames } from './mergeActions'

/**
 * The overview of a list row without opening the MR: what the list already
 * fetched, so it appears at once. Space on a row toggles it; while it is open
 * it follows the focused row, and Escape closes it.
 */
export function MergeRequestPreview({ approval, closeAt, mergeRequest, onClose, onOpen }: { approval: string | null; closeAt?: PointerSpot; mergeRequest: MergeRequest; onClose: () => void; onOpen: () => void }) {
  const t = useT()
  const rootRef = useRef<HTMLElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const [closeSpot, setCloseSpot] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    // Opening the preview narrows the list, so the button that was clicked moves away
    // from the pointer; a close button appears where the pointer still is instead.
    const root = rootRef.current
    if (!closeAt || !root) { setCloseSpot(null); return }
    const box = root.getBoundingClientRect()
    const headerBottom = headerRef.current?.offsetHeight ?? 0
    const half = CLOSE_SPOT_SIZE / 2
    setCloseSpot({
      left: Math.min(Math.max(closeAt.x - box.left - half, 0), Math.max(box.width - CLOSE_SPOT_SIZE, 0)),
      top: Math.min(Math.max(closeAt.y - box.top - half, headerBottom), Math.max(box.height - CLOSE_SPOT_SIZE, headerBottom)),
    })
  }, [closeAt])
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose])
  const people = [
    mergeRequest.assignees?.length ? t('mergeRequest.people.assigneesList', { names: formatNames(mergeRequest.assignees.map((person) => person.name)) }) : null,
    mergeRequest.reviewers?.length ? t('mergeRequest.people.reviewersList', { names: formatNames(mergeRequest.reviewers.map((person) => person.name)) }) : null,
  ].filter(Boolean)

  return (
    <Box aria-label={t('mergeRequest.preview.label', { iid: mergeRequest.iid })} component="aside" ref={rootRef} sx={{ bgcolor: 'background.paper', borderLeft: 1, borderColor: 'divider', display: 'flex', flexDirection: 'column', flexShrink: 0, minHeight: 0, position: 'relative', width: 'min(520px, 50%)' }}>
      {/* Keyboard and screen reader users close with Esc or the header's button; this one only saves pointer travel. */}
      {closeSpot ? <Tooltip title={t('mergeRequest.common.closeEsc')}><IconButton aria-hidden onClick={onClose} sx={{ bgcolor: 'surface.raised', border: 1, borderColor: 'divider', boxShadow: 2, left: closeSpot.left, position: 'absolute', top: closeSpot.top, zIndex: 1, '&:hover': { bgcolor: 'surface.raised' } }} tabIndex={-1}><CloseRoundedIcon /></IconButton></Tooltip> : null}
      <Stack direction="row" ref={headerRef} spacing={0.5} sx={{ alignItems: 'center', borderBottom: 1, borderColor: 'divider', flexShrink: 0, pl: 1.5, pr: 0.5, py: 0.5 }}>
        <Tooltip title={`${mergeRequest.projectPath || t('mergeRequest.common.projectFallback', { id: mergeRequest.projectId })} !${mergeRequest.iid}`}><Typography color="textSecondary" noWrap sx={{ flex: 1, minWidth: 0 }} variant="caption">{mergeRequest.projectPath || t('mergeRequest.common.projectFallback', { id: mergeRequest.projectId })} !{mergeRequest.iid}</Typography></Tooltip>
        <Button onClick={onOpen} size="small" startIcon={<OpenInFullRoundedIcon />} variant="contained">{t('mergeRequest.preview.open')}</Button>
        <Tooltip title={t('mergeRequest.common.closeEsc')}><IconButton aria-label={t('mergeRequest.preview.close')} onClick={onClose}><CloseRoundedIcon /></IconButton></Tooltip>
      </Stack>
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 2, py: 1.5 }}>
        <Typography component="h2" sx={{ overflowWrap: 'anywhere' }} variant="h2">{mergeRequest.title}</Typography>
        <Stack direction="row" sx={{ alignItems: 'center', columnGap: 1, flexWrap: 'wrap', mt: 1, rowGap: 0.5 }}>
          <StatusPill icon={<MergeRequestStateGlyph state={mergeRequest.state} />} label={formatMergeRequestState(mergeRequest.state)} tone={mergeRequestStateTone(mergeRequest.state)} />
          {approval ? <Typography color="textSecondary" variant="caption">{approval}</Typography> : null}
          <Typography sx={{ fontWeight: 500 }} variant="caption">{mergeRequest.author.name}</Typography>
          <RelativeTime prefix={t('mergeRequest.common.updated')} value={mergeRequest.updatedAt} />
        </Stack>
        <Typography color="textSecondary" component="div" sx={{ fontFamily: 'code.fontFamily', mt: 1, overflowWrap: 'anywhere' }} variant="caption">{mergeRequest.sourceBranch} → {mergeRequest.targetBranch}</Typography>
        {people.length ? <Typography color="textSecondary" component="div" sx={{ mt: 0.25 }} variant="caption">{people.join(' · ')}</Typography> : null}
        {mergeRequest.labels?.length ? <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5, mt: 1 }}>{mergeRequest.labels.map((label) => <Chip key={label} label={label} size="small" variant="outlined" />)}</Stack> : null}
        <Box sx={{ borderTop: 1, borderColor: 'divider', mt: 1.5, pt: 1.5 }}>
          <MarkdownLinkProvider projectUrl={projectUrlOf(mergeRequest.webUrl)}><MockMarkdown body={mergeRequest.description || t('mergeRequest.common.descriptionEmpty')} /></MarkdownLinkProvider>
        </Box>
      </Box>
    </Box>
  )
}

/** A pointer position in viewport coordinates. */
export interface PointerSpot { x: number; y: number }

/** The theme's icon button size. */
const CLOSE_SPOT_SIZE = 32
