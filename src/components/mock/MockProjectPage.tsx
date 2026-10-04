import AccessTimeOutlinedIcon from '@mui/icons-material/AccessTimeOutlined'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import FavoriteBorderOutlinedIcon from '@mui/icons-material/FavoriteBorderOutlined'
import FavoriteOutlinedIcon from '@mui/icons-material/FavoriteOutlined'
import SearchOutlinedIcon from '@mui/icons-material/SearchOutlined'
import TextSnippetOutlinedIcon from '@mui/icons-material/TextSnippetOutlined'
import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import List from '@mui/material/List'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useMemo } from 'react'

import { EmptyState } from '../EmptyState'
import { StatusPill, type StatusTone } from '../StatusPill'
import { getDiscussionCount, type MockMergeRequest, type MockProject } from '../../mock/fixtures'

export type ProjectMrFilter = 'all' | 'open' | 'merged' | 'closed'

interface MockProjectPageProps {
  favorite: boolean
  filter: ProjectMrFilter
  mergeRequests: MockMergeRequest[]
  onBackToProjects: () => void
  onFilterChange: (filter: ProjectMrFilter) => void
  onOpenMr: (id: string) => void
  onQueryChange: (query: string) => void
  onToggleFavorite: () => void
  project: MockProject
  query: string
}

const filterTabs: Array<{ key: ProjectMrFilter; label: string }> = [
  { key: 'all', label: 'すべて' },
  { key: 'open', label: 'Open' },
  { key: 'merged', label: 'Merged' },
  { key: 'closed', label: 'Closed' },
]

function projectStateLabel(mergeRequest: MockMergeRequest) {
  if (mergeRequest.state === 'merged') return 'Merged'
  if (mergeRequest.state === 'closed') return 'Closed'
  if (mergeRequest.reviewState === 'approved') return '承認済み'
  if (mergeRequest.reviewState === 'changes-requested') return '要修正'
  return '要レビュー'
}

function projectStateTone(mergeRequest: MockMergeRequest): StatusTone {
  if (mergeRequest.state === 'merged') return 'info'
  if (mergeRequest.state === 'closed') return 'default'
  if (mergeRequest.reviewState === 'approved') return 'success'
  if (mergeRequest.reviewState === 'changes-requested') return 'error'
  return 'warning'
}

function countForFilter(mergeRequests: MockMergeRequest[], filter: ProjectMrFilter) {
  return filter === 'all' ? mergeRequests.length : mergeRequests.filter((mergeRequest) => mergeRequest.state === filter).length
}

export function MockProjectPage({
  favorite,
  filter,
  mergeRequests,
  onBackToProjects,
  onFilterChange,
  onOpenMr,
  onQueryChange,
  onToggleFavorite,
  project,
  query,
}: MockProjectPageProps) {
  const results = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('ja-JP')
    return mergeRequests.filter((mergeRequest) => {
      const matchesStatus = filter === 'all' || mergeRequest.state === filter
      const searchable = `${mergeRequest.title} ${mergeRequest.description}`.toLocaleLowerCase('ja-JP')
      return matchesStatus && (!normalizedQuery || searchable.includes(normalizedQuery))
    })
  }, [filter, mergeRequests, query])

  const openCount = countForFilter(mergeRequests, 'open')
  const mergedCount = countForFilter(mergeRequests, 'merged')
  const closedCount = countForFilter(mergeRequests, 'closed')

  return (
    <Box component="main" sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: { xs: 1.5, md: 2.5 } }}>
      <Stack spacing={1.75} sx={{ maxWidth: 1040, mx: 'auto' }}>
        <Stack spacing={1.25}>
          <Button
            aria-label="プロジェクト一覧へ戻る"
            onClick={onBackToProjects}
            size="small"
            startIcon={<ArrowBackRoundedIcon />}
            sx={{ alignSelf: 'flex-start', fontSize: 'caption.fontSize', minWidth: 0, px: 0.5 }}
          >
            プロジェクト一覧
          </Button>
          <Stack direction="row" spacing={1.25} sx={{ alignItems: 'flex-start', minWidth: 0 }}>
            <Avatar sx={{ bgcolor: 'action.selected', color: 'primary.main', fontSize: 'body2.fontSize', fontWeight: 'fontWeightBold', height: 38, width: 38 }}>
              {project.name.slice(0, 1)}
            </Avatar>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', minWidth: 0 }}>
                <Typography component="h1" noWrap sx={{ fontSize: { xs: 20, md: 23 }, fontWeight: 'fontWeightBold', letterSpacing: '-0.03em' }}>
                  {project.name}
                </Typography>
                <Tooltip title={favorite ? 'お気に入りを外す' : 'お気に入りに追加'}>
                  <IconButton aria-label={favorite ? `${project.name}をお気に入りから外す` : `${project.name}をお気に入りに追加`} onClick={onToggleFavorite} size="small">
                    {favorite ? <FavoriteOutlinedIcon color="warning" sx={{ fontSize: 18 }} /> : <FavoriteBorderOutlinedIcon sx={{ fontSize: 18 }} />}
                  </IconButton>
                </Tooltip>
              </Stack>
              <Typography color="text.secondary" sx={{ fontSize: 'caption.fontSize', mt: 0.2 }}>{project.path}</Typography>
              <Typography color="text.secondary" sx={{ fontSize: 'body2.fontSize', lineHeight: 1.65, mt: 0.65, maxWidth: 720 }}>{project.description}</Typography>
            </Box>
          </Stack>
          <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexWrap: 'wrap', pl: { xs: 0, md: 6.25 } }}>
            <Chip label={`${mergeRequests.length} MR`} size="small" variant="outlined" />
            <Chip label={`${openCount} open`} color="primary" size="small" variant="outlined" />
            <Typography color="text.secondary" sx={{ fontSize: 'caption.fontSize' }}>{mergedCount} merged · {closedCount} closed</Typography>
            <Typography color="text.disabled" sx={{ fontSize: 'caption.fontSize' }}>·</Typography>
            <Typography color="text.secondary" sx={{ fontSize: 'caption.fontSize' }}>{project.activity}</Typography>
          </Stack>
        </Stack>

        <Paper component="section" aria-label={`${project.name}のMerge requests`} variant="outlined" sx={{ bgcolor: 'background.paper', p: { xs: 1.25, md: 1.5 } }}>
          <Stack spacing={1.15}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}>
              <Box>
                <Typography component="h2" sx={{ fontSize: 14, fontWeight: 'fontWeightBold' }}>Merge requests</Typography>
                <Typography color="text.secondary" sx={{ fontSize: 'caption.fontSize', mt: 0.25 }}>このプロジェクトの変更を、現在と過去の両方から確認できます。</Typography>
              </Box>
              <TextField
                onChange={(event) => onQueryChange(event.target.value)}
                placeholder="タイトル・説明を検索"
                value={query}
                slotProps={{
                  htmlInput: { 'aria-label': `${project.name}のMRをタイトル・説明で検索` },
                  input: { startAdornment: <InputAdornment position="start"><SearchOutlinedIcon sx={{ color: 'text.secondary', fontSize: 17 }} /></InputAdornment> },
                }}
                sx={{ minWidth: { sm: 260 }, '& .MuiInputBase-root': { fontSize: 'body2.fontSize', minHeight: 36 } }}
              />
            </Stack>
            <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', minWidth: 0 }}>
              <Tabs
                aria-label={`${project.name}のMerge request状態`}
                onChange={(_, value: ProjectMrFilter) => onFilterChange(value)}
                scrollButtons={false}
                sx={{ minHeight: 31, '& .MuiTab-root': { minHeight: 31, minWidth: 0, px: 0.8, fontSize: 'caption.fontSize', fontWeight: 'fontWeightBold' } }}
                value={filter}
                variant="scrollable"
              >
                {filterTabs.map(({ key, label }) => <Tab key={key} label={`${label} ${countForFilter(mergeRequests, key)}`} value={key} />)}
              </Tabs>
              <Typography color="text.secondary" sx={{ flexShrink: 0, fontSize: 'caption.fontSize', ml: 1 }}>{results.length}件</Typography>
            </Stack>
          </Stack>
        </Paper>

        {results.length > 0 ? (
          <List aria-label={`${project.name}のMerge request一覧`} disablePadding sx={{ display: 'grid', gap: 0.75 }}>
            {results.map((mergeRequest) => (
              <Paper component="article" key={mergeRequest.id} variant="outlined" sx={{ bgcolor: 'background.paper' }}>
                <Stack spacing={0.7} sx={{ p: { xs: 1.25, md: 1.5 } }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', minWidth: 0 }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', minWidth: 0 }}>
                        <Typography color="text.secondary" sx={{ flexShrink: 0, fontSize: 'caption.fontSize' }}>!{mergeRequest.iid}</Typography>
                        <StatusPill label={projectStateLabel(mergeRequest)} size="small" subtle tone={projectStateTone(mergeRequest)} />
                      </Stack>
                      <Button
                        aria-label={`!${mergeRequest.iid} ${mergeRequest.title}を開く`}
                        onClick={() => onOpenMr(mergeRequest.id)}
                        sx={{ display: 'block', fontSize: 'body2.fontSize', fontWeight: 'fontWeightBold', justifyContent: 'flex-start', lineHeight: 1.45, minWidth: 0, mt: 0.35, overflow: 'hidden', px: 0, textAlign: 'left', textOverflow: 'ellipsis', textTransform: 'none', whiteSpace: 'nowrap', width: '100%' }}
                      >
                        {mergeRequest.title}
                      </Button>
                    </Box>
                    <Button aria-label={`MR !${mergeRequest.iid}を開く`} onClick={() => onOpenMr(mergeRequest.id)} size="small" sx={{ flexShrink: 0, fontSize: 'caption.fontSize', mt: 1.1 }} variant="outlined">
                      開く
                    </Button>
                  </Stack>
                  <Typography color="text.secondary" sx={{ display: '-webkit-box', fontSize: 'body2.fontSize', lineHeight: 1.55, overflow: 'hidden', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2 }}>
                    {mergeRequest.description}
                  </Typography>
                  <Stack direction="row" spacing={1.1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                    <Typography color="text.secondary" sx={{ fontSize: 'caption.fontSize' }}>{mergeRequest.author.name}</Typography>
                    <Typography color="text.disabled" sx={{ fontSize: 'caption.fontSize' }}>·</Typography>
                    <Stack direction="row" spacing={0.35} sx={{ alignItems: 'center' }}>
                      <TextSnippetOutlinedIcon sx={{ color: 'text.disabled', fontSize: 15 }} />
                      <Typography color="text.secondary" sx={{ fontSize: 'caption.fontSize' }}>{mergeRequest.files.length} files</Typography>
                    </Stack>
                    <Stack direction="row" spacing={0.35} sx={{ alignItems: 'center' }}>
                      <Typography color="text.secondary" sx={{ fontSize: 'caption.fontSize' }}>{getDiscussionCount(mergeRequest)} comments</Typography>
                    </Stack>
                    <Box sx={{ flex: 1 }} />
                    <Stack direction="row" spacing={0.35} sx={{ alignItems: 'center' }}>
                      <AccessTimeOutlinedIcon sx={{ color: 'text.disabled', fontSize: 15 }} />
                      <Typography color="text.secondary" sx={{ fontSize: 'caption.fontSize' }}>{mergeRequest.updatedAt}</Typography>
                    </Stack>
                  </Stack>
                </Stack>
              </Paper>
            ))}
          </List>
        ) : (
          <EmptyState
            description={query.trim() ? '検索語か状態を変えて、このプロジェクトのMRを探してください。' : filter === 'open' ? '現在オープンのMRはありません。過去のMRは「すべて」または「Merged」から確認できます。' : 'この条件に一致するMRはありません。'}
            title={query.trim() ? '一致するMRがありません' : `${filter === 'open' ? 'オープン' : filter === 'merged' ? 'Merged' : filter === 'closed' ? 'Closed' : '表示対象'}のMRがありません`}
          />
        )}
      </Stack>
    </Box>
  )
}
