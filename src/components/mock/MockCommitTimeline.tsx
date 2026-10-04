import Box from '@mui/material/Box'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'

import type { MockCommit } from '../../mock/commits'

export type MockCommitTimelineValue = 'overall' | string

interface MockCommitTimelineProps {
  commits: MockCommit[]
  onChange: (value: MockCommitTimelineValue) => void
  value: MockCommitTimelineValue
}

function TimelineDot({ selected }: { selected: boolean }) {
  return (
    <Box
      aria-hidden="true"
      sx={{
        bgcolor: selected ? 'primary.main' : 'background.paper',
        border: 2,
        borderColor: selected ? 'primary.main' : 'divider',
        borderRadius: '50%',
        flexShrink: 0,
        height: 12,
        position: 'relative',
        width: 12,
        zIndex: 1,
      }}
    />
  )
}

function TimelineLabel({
  commit,
  selected,
  overall = false,
}: {
  commit?: MockCommit
  overall?: boolean
  selected: boolean
}) {
  const subject = overall ? 'すべての変更' : commit?.message.split('\n')[0] ?? ''
  const secondary = overall ? 'MR全体' : `${commit?.sha ?? '—'} · ${commit?.date ?? ''}`

  return (
    <Box sx={{ display: 'grid', gridTemplateRows: '17px 15px 17px', minWidth: 0, textAlign: 'left', width: '100%' }}>
      <Box sx={{ alignItems: 'center', display: 'flex', minHeight: 17 }}>
        <TimelineDot selected={selected} />
      </Box>
      <Typography color={selected ? 'text.primary' : 'text.secondary'} noWrap sx={{ fontSize: 'caption.fontSize', fontWeight: 'fontWeightBold', lineHeight: 1.2 }}>
        {secondary}
      </Typography>
      <Tooltip placement="bottom-start" title={commit?.message ?? subject}>
        <Typography color={selected ? 'text.primary' : 'text.secondary'} noWrap sx={{ fontSize: 'caption.fontSize', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {subject}
        </Typography>
      </Tooltip>
    </Box>
  )
}

/**
 * Compact comparison strip for the changes view. The overall MR is always
 * the first stop, followed by commits in the order supplied by the API.
 */
export function MockCommitTimeline({ commits, onChange, value }: MockCommitTimelineProps) {
  return (
    <Box aria-label="比較対象のタイムライン" sx={{ minWidth: 0, overflow: 'hidden' }}>
      <Tabs
        aria-label="比較対象のタイムライン"
        onChange={(_, nextValue: MockCommitTimelineValue) => onChange(nextValue)}
        selectionFollowsFocus
        scrollButtons="auto"
        sx={{
          minHeight: 66,
          '& .MuiTab-root': {
            alignItems: 'stretch',
            borderBottom: 0,
            justifyContent: 'flex-start',
            minHeight: 66,
            minWidth: 0,
            px: 1,
            py: 0.7,
            position: 'relative',
            textTransform: 'none',
          },
          '& .MuiTabs-indicator': {
            bottom: 0,
            height: 2,
          },
        }}
        value={value}
        variant="scrollable"
      >
        <Tab
          aria-label="MR全体"
          label={<TimelineLabel overall selected={value === 'overall'} />}
          sx={{ '&::before': { borderTop: commits.length ? 1 : 0, borderColor: 'divider', content: '""', left: 14, position: 'absolute', right: 0, top: 14 }, flexShrink: 0, width: 112 }}
          value="overall"
        />
        {commits.map((commit) => {
          const selected = value === commit.id
          const label = <TimelineLabel commit={commit} selected={selected} />
          return (
            <Tab
              key={commit.id}
              aria-label={`${commit.sha} ${commit.message.split('\n')[0]}`}
              label={label}
              sx={{ '&::before': { borderTop: 1, borderColor: 'divider', content: '""', left: 0, position: 'absolute', right: 0, top: 14 }, '&:last-child::before': { right: 'calc(100% - 14px)' }, flexShrink: 0, width: 200 }}
              value={commit.id}
            />
          )
        })}
      </Tabs>
    </Box>
  )
}
