import AccessTimeOutlinedIcon from '@mui/icons-material/AccessTimeOutlined'
import CheckCircleOutlineOutlinedIcon from '@mui/icons-material/CheckCircleOutlineOutlined'
import FilterListOutlinedIcon from '@mui/icons-material/FilterListOutlined'
import SearchOutlinedIcon from '@mui/icons-material/SearchOutlined'
import TextSnippetOutlinedIcon from '@mui/icons-material/TextSnippetOutlined'
import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'

import { StatusPill, type StatusTone } from '../StatusPill'
import { getDiscussionCount, type MockMergeRequest } from '../../mock/fixtures'

export type MrFilter = 'all' | 'open' | 'merged' | 'closed' | 'needs-review'

interface MockMrListProps {
  allMergeRequests: MockMergeRequest[]
  mergeRequests: MockMergeRequest[]
  query: string
  filter: MrFilter
  selectedId: string
  onFilterChange: (filter: MrFilter) => void
  onQueryChange: (query: string) => void
  onSelect: (id: string) => void
}

const filterTabs: Array<{ key: MrFilter; label: string }> = [
  { key: 'needs-review', label: '要レビュー' },
  { key: 'open', label: 'オープン' },
  { key: 'all', label: 'すべて' },
  { key: 'merged', label: 'Merged' },
]

function stateLabel(mergeRequest: MockMergeRequest) {
  if (mergeRequest.state === 'merged') return 'Merged'
  if (mergeRequest.state === 'closed') return 'Closed'
  if (mergeRequest.reviewState === 'approved') return '承認済み'
  if (mergeRequest.reviewState === 'changes-requested') return '要修正'
  return '要レビュー'
}

function stateTone(mergeRequest: MockMergeRequest): StatusTone {
  if (mergeRequest.state === 'merged') return 'info'
  if (mergeRequest.state === 'closed') return 'default'
  if (mergeRequest.reviewState === 'approved') return 'success'
  if (mergeRequest.reviewState === 'changes-requested') return 'error'
  return 'warning'
}

function filterCount(mergeRequests: MockMergeRequest[], filter: MrFilter) {
  if (filter === 'all') return mergeRequests.length
  if (filter === 'needs-review') {
    return mergeRequests.filter((mergeRequest) => mergeRequest.state === 'open' && mergeRequest.reviewState !== 'approved').length
  }
  return mergeRequests.filter((mergeRequest) => mergeRequest.state === filter).length
}

export function MockMrList({
  allMergeRequests,
  mergeRequests,
  query,
  filter,
  selectedId,
  onFilterChange,
  onQueryChange,
  onSelect,
}: MockMrListProps) {
  return (
    <Box
      component="section"
      aria-label="Merge request一覧"
      sx={{
        bgcolor: 'background.paper',
        borderRight: 1,
        borderColor: 'divider',
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        width: 314,
        '@media (max-width: 1100px)': { borderRight: 0, width: '100%' },
      }}
    >
      <Stack spacing={1.25} sx={{ p: 1.75, pb: 1.25 }}>
        <Stack direction="row" sx={{ alignItems: 'start', justifyContent: 'space-between' }}>
          <Box>
            <Typography sx={{ fontSize: 14, fontWeight: 700, letterSpacing: '-0.02em' }}>レビューキュー</Typography>
            <Typography color="text.secondary" sx={{ fontSize: 'caption.fontSize', mt: 0.35 }}>
              サンプルデータ · {mergeRequests.length}件のMR
            </Typography>
          </Box>
          <Tooltip title={filter === 'needs-review' ? 'すべて表示' : '要レビューだけ表示'}>
            <IconButton aria-label={filter === 'needs-review' ? 'すべて表示' : '要レビューだけ表示'} onClick={() => onFilterChange(filter === 'needs-review' ? 'all' : 'needs-review')} size="small">
              <FilterListOutlinedIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        </Stack>
        <TextField
          fullWidth
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="タイトル・説明を検索"
          value={query}
          slotProps={{
            htmlInput: { 'aria-label': 'タイトル・説明を検索' },
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchOutlinedIcon sx={{ color: 'text.secondary', fontSize: 17 }} />
                </InputAdornment>
              ),
            },
          }}
          sx={{ '& .MuiInputBase-root': { fontSize: 'body2.fontSize', minHeight: 36 } }}
        />
        <Tabs
          aria-label="Merge requestの状態"
          onChange={(_, value: MrFilter) => onFilterChange(value)}
          scrollButtons={false}
          sx={{ minHeight: 29, '& .MuiTab-root': { minHeight: 29, minWidth: 0, px: 0.65, fontSize: 'caption.fontSize', fontWeight: 'fontWeightBold' } }}
          value={filter}
          variant="scrollable"
        >
          {filterTabs.map(({ key, label }) => (
            <Tab key={key} label={`${label} ${filterCount(allMergeRequests, key)}`} value={key} />
          ))}
        </Tabs>
      </Stack>
      <Divider />
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 0.85, py: 0.75 }}>
        {mergeRequests.length > 0 ? (
          <List disablePadding>
            {mergeRequests.map((mergeRequest) => {
              const discussionCount = getDiscussionCount(mergeRequest)
              return (
                <ListItemButton
                  key={mergeRequest.id}
                  aria-current={selectedId === mergeRequest.id ? 'true' : undefined}
                  aria-label={`${mergeRequest.projectName} !${mergeRequest.iid} ${mergeRequest.title}`}
                  onClick={() => onSelect(mergeRequest.id)}
                  selected={selectedId === mergeRequest.id}
                  sx={{
                    alignItems: 'stretch',
                    display: 'block',
                    mb: 0.4,
                    px: 1,
                    py: 1,
                    '&.Mui-selected': { bgcolor: 'action.selected' },
                    '&.Mui-selected:hover': { bgcolor: 'action.selected' },
                  }}
                >
                  <Stack spacing={0.7}>
                    <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                      <Typography color="text.secondary" noWrap sx={{ fontSize: 'caption.fontSize', maxWidth: 180 }}>
                        {mergeRequest.projectPath} · !{mergeRequest.iid}
                      </Typography>
                      <StatusPill label={stateLabel(mergeRequest)} size="small" subtle tone={stateTone(mergeRequest)} />
                    </Stack>
                    <ListItemText
                      primary={mergeRequest.title}
                      slotProps={{
                        primary: {
                          sx: {
                            display: '-webkit-box',
                            fontSize: 'body2.fontSize',
                            fontWeight: 700,
                            lineHeight: 1.45,
                            overflow: 'hidden',
                            WebkitBoxOrient: 'vertical',
                            WebkitLineClamp: 2,
                          },
                        },
                      }}
                    />
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <Avatar sx={{ bgcolor: 'action.hover', color: 'primary.main', fontSize: 'caption.fontSize', fontWeight: 'fontWeightBold', height: 18, width: 18 }}>
                        {mergeRequest.author.initials}
                      </Avatar>
                      <Typography color="text.secondary" noWrap sx={{ fontSize: 'caption.fontSize', minWidth: 0 }}>
                        {mergeRequest.author.name}
                      </Typography>
                      <Box sx={{ flex: 1 }} />
                      <Stack direction="row" spacing={0.35} sx={{ alignItems: 'center' }}>
                        <TextSnippetOutlinedIcon sx={{ color: 'text.disabled', fontSize: 'body2.fontSize' }} />
                        <Typography color="text.secondary" sx={{ fontSize: 'caption.fontSize' }}>{mergeRequest.files.length}</Typography>
                        <Typography color="text.disabled" sx={{ fontSize: 'caption.fontSize' }}>·</Typography>
                        <Typography color="text.secondary" sx={{ fontSize: 'caption.fontSize' }}>{discussionCount}</Typography>
                      </Stack>
                    </Stack>
                    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                      <CheckCircleOutlineOutlinedIcon sx={{ color: mergeRequest.checksPassed === mergeRequest.checksTotal ? 'success.main' : 'warning.main', fontSize: 'body2.fontSize' }} />
                      <Typography color="text.secondary" sx={{ fontSize: 'caption.fontSize' }}>{mergeRequest.checksPassed}/{mergeRequest.checksTotal} checks</Typography>
                      <Box sx={{ flex: 1 }} />
                      <AccessTimeOutlinedIcon sx={{ color: 'text.disabled', fontSize: 'body2.fontSize' }} />
                      <Typography color="text.secondary" sx={{ fontSize: 'caption.fontSize' }}>{mergeRequest.updatedAt}</Typography>
                    </Stack>
                  </Stack>
                </ListItemButton>
              )
            })}
          </List>
        ) : (
          <Paper sx={{ bgcolor: 'action.hover', mt: 1, p: 2, textAlign: 'center' }}>
            <Typography sx={{ fontSize: 'caption.fontSize', fontWeight: 'fontWeightBold' }}>一致するMRがありません</Typography>
            <Typography color="text.secondary" sx={{ fontSize: 'caption.fontSize', mt: 0.5 }}>検索語か状態を変えてみてください。</Typography>
          </Paper>
        )}
      </Box>
    </Box>
  )
}
