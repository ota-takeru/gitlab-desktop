import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded'
import KeyboardArrowUpRoundedIcon from '@mui/icons-material/KeyboardArrowUpRounded'
import IconButton from '@mui/material/IconButton'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'

import { hairline, panelFrame } from '../../components/hairline'
import type { Discussion } from '../../types/gitlab'
import { isUnresolvedDiscussion } from './discussionStatus'
import { plainExcerpt } from './discussionText'
import { useT } from '../../i18n/useT'
import { Row } from '../../components/Row'

/** Unresolved threads of the loaded discussions; choosing one scrolls the list to it. */
export function UnresolvedThreadNav({ discussions, olderNotLoaded, onSelect }: { discussions: Discussion[]; olderNotLoaded: boolean; onSelect: (discussionId: string) => void }) {
  const t = useT()
  const threads = discussions.filter(isUnresolvedDiscussion)
  return (
    <Stack aria-label={t('review.unresolved.title')} component="nav" sx={{ bgcolor: 'surface.raised', ...panelFrame(), borderRadius: 1, minWidth: 0 }}>
      <Row sx={{ ...hairline('bottom'), px: 1.5, py: 0.5 }}>
        <Typography color="textSecondary" variant="overline">{t('review.unresolved.title')}</Typography>
        <Typography color="textSecondary" sx={{ ml: 'auto' }} variant="caption">{t('review.unresolved.count', { count: threads.length })}</Typography>
      </Row>
      {threads.length === 0 ? <Typography color="textSecondary" sx={{ px: 1.5, py: 1 }} variant="caption">{t('review.unresolved.none')}</Typography> : (
        <List disablePadding sx={{ py: 0.5 }}>
          {threads.map((discussion) => {
            const first = discussion.notes.find((note) => !note.system)
            const position = discussion.notes.find((note) => note.position)?.position
            const place = position ? `${position.newPath.slice(position.newPath.lastIndexOf('/') + 1)}:${position.newLine ?? position.oldLine ?? 'file'}` : t('review.unresolved.overview')
            return (
              <ListItemButton key={discussion.id} onClick={() => onSelect(discussion.id)} sx={{ alignItems: 'stretch', flexDirection: 'column', px: 1.5, py: 0.5 }}>
                <Tooltip placement="left" title={`${position ? `${position.newPath}:${position.newLine ?? position.oldLine ?? 'file'}` : place}${first ? ` · ${first.author.name}` : ''}`}><Typography color="textSecondary" noWrap sx={{ fontFamily: position ? 'code.fontFamily' : undefined }} variant="caption">{place}{first ? ` · ${first.author.name}` : ''}</Typography></Tooltip>
                <Typography sx={{ display: '-webkit-box', overflow: 'hidden', overflowWrap: 'anywhere', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2 }} variant="body2">{first ? plainExcerpt(first.body) : ''}</Typography>
              </ListItemButton>
            )
          })}
        </List>
      )}
      {olderNotLoaded ? <Typography color="textSecondary" sx={{ ...hairline('top'), px: 1.5, py: 0.5 }} variant="caption">{t('review.unresolved.olderNotLoaded')}</Typography> : null}
    </Stack>
  )
}

/** The arrows stay as small as the caption beside them, in a 24px target. */
const stepSx = { fontSize: 16, height: 24, width: 24, '--edge-inset': '4px' }

/** Compact previous/next unresolved thread control, usable at any width (also with P / N). */
export function UnresolvedThreadStepper({ count, onStep }: { count: number; onStep: (direction: 1 | -1) => void }) {
  const t = useT()
  return (
    <Row aria-label={t('review.unresolved.navigate')} role="group" sx={{ flexShrink: 0 }}>
      <Typography color="textSecondary" noWrap sx={{ pr: 0.25 }} variant="caption">{t('review.unresolved.stepperCount', { count })}</Typography>
      <Tooltip title={t('review.unresolved.previousTooltip')}><IconButton aria-label={t('review.unresolved.previous')} aria-keyshortcuts="P" onClick={() => onStep(-1)} sx={stepSx}><KeyboardArrowUpRoundedIcon fontSize="inherit" /></IconButton></Tooltip>
      <Tooltip title={t('review.unresolved.nextTooltip')}><IconButton aria-label={t('review.unresolved.next')} aria-keyshortcuts="N" onClick={() => onStep(1)} sx={stepSx}><KeyboardArrowDownRoundedIcon fontSize="inherit" /></IconButton></Tooltip>
    </Row>
  )
}
