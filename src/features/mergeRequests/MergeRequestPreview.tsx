import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import OpenInFullRoundedIcon from '@mui/icons-material/OpenInFullRounded'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useEffect } from 'react'

import { MockMarkdown } from '../../components/mock/MockMarkdown'
import { RelativeTime } from '../../components/RelativeTime'
import { StatusPill } from '../../components/StatusPill'
import { formatMergeRequestState, mergeRequestStateTone } from '../../lib/format'
import type { MergeRequest } from '../../types/gitlab'

/**
 * The overview of a list row without opening the MR: what the list already
 * fetched, so it appears at once. Space on a row toggles it; while it is open
 * it follows the focused row, and Escape closes it.
 */
export function MergeRequestPreview({ approval, mergeRequest, onClose, onOpen }: { approval: string | null; mergeRequest: MergeRequest; onClose: () => void; onOpen: () => void }) {
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
    mergeRequest.assignees?.length ? `担当: ${mergeRequest.assignees.map((person) => person.name).join('、')}` : null,
    mergeRequest.reviewers?.length ? `レビュー: ${mergeRequest.reviewers.map((person) => person.name).join('、')}` : null,
  ].filter(Boolean)

  return (
    <Box aria-label={`!${mergeRequest.iid}の概要`} component="aside" sx={{ bgcolor: 'background.paper', borderLeft: 1, borderColor: 'divider', display: 'flex', flexDirection: 'column', flexShrink: 0, minHeight: 0, width: 'min(520px, 50%)' }}>
      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', borderBottom: 1, borderColor: 'divider', flexShrink: 0, pl: 1.5, pr: 0.5, py: 0.5 }}>
        <Tooltip title={`${mergeRequest.projectPath || `プロジェクト ${mergeRequest.projectId}`} !${mergeRequest.iid}`}><Typography color="textSecondary" noWrap sx={{ flex: 1, minWidth: 0 }} variant="caption">{mergeRequest.projectPath || `プロジェクト ${mergeRequest.projectId}`} !{mergeRequest.iid}</Typography></Tooltip>
        <Button onClick={onOpen} size="small" startIcon={<OpenInFullRoundedIcon />} variant="contained">MRを開く</Button>
        <Tooltip title="閉じる (Esc)"><IconButton aria-label="概要を閉じる" onClick={onClose}><CloseRoundedIcon /></IconButton></Tooltip>
      </Stack>
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 2, py: 1.5 }}>
        <Typography component="h2" sx={{ overflowWrap: 'anywhere' }} variant="h2">{mergeRequest.title}</Typography>
        <Stack direction="row" sx={{ alignItems: 'center', columnGap: 1, flexWrap: 'wrap', mt: 1, rowGap: 0.5 }}>
          <StatusPill label={formatMergeRequestState(mergeRequest.state)} tone={mergeRequestStateTone(mergeRequest.state)} />
          {approval ? <Typography color="textSecondary" variant="caption">{approval}</Typography> : null}
          <Typography sx={{ fontWeight: 500 }} variant="caption">{mergeRequest.author.name}</Typography>
          <RelativeTime prefix="更新" value={mergeRequest.updatedAt} />
        </Stack>
        <Typography color="textSecondary" component="div" sx={{ fontFamily: 'code.fontFamily', mt: 1, overflowWrap: 'anywhere' }} variant="caption">{mergeRequest.sourceBranch} → {mergeRequest.targetBranch}</Typography>
        {people.length ? <Typography color="textSecondary" component="div" sx={{ mt: 0.25 }} variant="caption">{people.join(' · ')}</Typography> : null}
        {mergeRequest.labels?.length ? <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5, mt: 1 }}>{mergeRequest.labels.map((label) => <Chip key={label} label={label} size="small" variant="outlined" />)}</Stack> : null}
        <Box sx={{ borderTop: 1, borderColor: 'divider', mt: 1.5, pt: 1.5 }}>
          <MockMarkdown body={mergeRequest.description || '説明はありません。'} />
        </Box>
      </Box>
    </Box>
  )
}
