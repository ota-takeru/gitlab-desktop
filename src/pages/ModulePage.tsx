import MergeTypeOutlinedIcon from '@mui/icons-material/MergeTypeOutlined'
import ReportProblemOutlinedIcon from '@mui/icons-material/ReportProblemOutlined'
import TimelineOutlinedIcon from '@mui/icons-material/TimelineOutlined'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'

import { EmptyState } from '../components/EmptyState'
import { StatusPill } from '../components/StatusPill'

export type ModuleKey = 'merge-requests' | 'issues' | 'pipelines'

const moduleDetails: Record<ModuleKey, {
  title: string
  eyebrow: string
  description: string
  emptyTitle: string
  emptyDescription: string
  icon: typeof MergeTypeOutlinedIcon
}> = {
  'merge-requests': {
    title: 'Merge requests',
    eyebrow: 'Review flow',
    description: 'レビュー中の変更を、自分の作業コンテキストに合わせて確認する領域です。',
    emptyTitle: 'Merge requests は未接続です',
    emptyDescription: 'GitLab の接続設定が完了すると、ここにレビュー対象を表示できます。現在はデータを読み込んでいません。',
    icon: MergeTypeOutlinedIcon,
  },
  issues: {
    title: 'Issues',
    eyebrow: 'Work queue',
    description: '課題の優先度と次に進める作業を整理する領域です。',
    emptyTitle: 'Issues は未接続です',
    emptyDescription: 'GitLab の接続設定が完了すると、ここに課題を表示できます。現在はデータを読み込んでいません。',
    icon: ReportProblemOutlinedIcon,
  },
  pipelines: {
    title: 'Pipelines',
    eyebrow: 'Delivery signal',
    description: 'パイプラインの状態と失敗の兆候を確認する領域です。',
    emptyTitle: 'Pipelines は未接続です',
    emptyDescription: 'GitLab の接続設定が完了すると、ここに実行履歴を表示できます。現在はデータを読み込んでいません。',
    icon: TimelineOutlinedIcon,
  },
}

export function ModulePage({ module }: { module: ModuleKey }) {
  const details = moduleDetails[module]
  const Icon = details.icon

  return (
    <Stack spacing={3.5} sx={{ maxWidth: 1120, mx: 'auto' }}>
      <Stack spacing={1}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Icon color="primary" fontSize="small" />
          <Typography color="primary.main" sx={{ fontWeight: 800 }} variant="overline">
            {details.eyebrow}
          </Typography>
        </Stack>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.5}
          sx={{ alignItems: { sm: 'center' } }}
        >
          <Typography component="h1" variant="h1">
            {details.title}
          </Typography>
          <StatusPill label="未接続" />
        </Stack>
        <Typography color="text.secondary" sx={{ maxWidth: 690 }} variant="body1">
          {details.description}
        </Typography>
      </Stack>
      <EmptyState description={details.emptyDescription} title={details.emptyTitle} />
    </Stack>
  )
}
