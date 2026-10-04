import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import MergeTypeOutlinedIcon from '@mui/icons-material/MergeTypeOutlined'
import ReportProblemOutlinedIcon from '@mui/icons-material/ReportProblemOutlined'
import TimelineOutlinedIcon from '@mui/icons-material/TimelineOutlined'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardActionArea from '@mui/material/CardActionArea'
import CardContent from '@mui/material/CardContent'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'

import { HealthPanel } from '../components/HealthPanel'
import { StatusPill } from '../components/StatusPill'
import type { PageKey } from '../components/AppShell'

interface OverviewPageProps {
  onPageChange: (page: PageKey) => void
}

const modules = [
  {
    key: 'merge-requests' as const,
    title: 'Merge requests',
    description: 'レビュー待ちの変更を確認します。',
    icon: MergeTypeOutlinedIcon,
  },
  {
    key: 'issues' as const,
    title: 'Issues',
    description: '課題の一覧と次のアクションをまとめます。',
    icon: ReportProblemOutlinedIcon,
  },
  {
    key: 'pipelines' as const,
    title: 'Pipelines',
    description: '実行状況を軽く確認できる場所を用意します。',
    icon: TimelineOutlinedIcon,
  },
]

export function OverviewPage({ onPageChange }: OverviewPageProps) {
  return (
    <Stack spacing={3.5} sx={{ maxWidth: 1120, mx: 'auto' }}>
      <Stack spacing={1}>
        <Typography color="primary.main" sx={{ fontWeight: 800 }} variant="overline">
          Workspace overview
        </Typography>
        <Typography component="h1" variant="h1">
          自分の GitLab 作業を、軽く始める
        </Typography>
        <Typography color="text.secondary" sx={{ maxWidth: 690 }} variant="body1">
          ここは個人向けクライアントの基礎画面です。まず実行環境を確かめ、接続レイヤーを追加したあとに各モジュールを育てていきます。
        </Typography>
        <Box>
          <Button href="#mock" endIcon={<ArrowForwardRoundedIcon />} variant="outlined">
            UIモックを開く
          </Button>
          <Typography color="text.secondary" sx={{ mt: 0.75 }} variant="caption">
            サンプルデータで画面と操作を確認できます。GitLabには接続しません。
          </Typography>
        </Box>
      </Stack>

      <HealthPanel />

      <Stack spacing={1.5}>
        <Stack direction="row" sx={{ alignItems: 'end', justifyContent: 'space-between' }}>
          <Box>
            <Typography component="h2" variant="h2">
              Workspace modules
            </Typography>
            <Typography color="text.secondary" variant="body2">
              いずれも GitLab 接続後にデータを表示する領域です。
            </Typography>
          </Box>
          <StatusPill label="未接続" tone="default" />
        </Stack>
        <Box
          sx={{
            display: 'grid',
            gap: 1.5,
            gridTemplateColumns: { md: 'repeat(3, 1fr)', xs: '1fr' },
          }}
        >
          {modules.map(({ description, icon: Icon, key, title }) => (
            <Card key={key}>
              <CardActionArea onClick={() => onPageChange(key)} sx={{ height: '100%' }}>
                <CardContent sx={{ p: 2.25 }}>
                  <Stack spacing={2}>
                    <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                      <Box
                        sx={{
                          alignItems: 'center',
                          bgcolor: 'action.hover',
                          borderRadius: 1.5,
                          color: 'primary.main',
                          display: 'flex',
                          height: 36,
                          justifyContent: 'center',
                          width: 36,
                        }}
                      >
                        <Icon fontSize="small" />
                      </Box>
                      <ArrowForwardRoundedIcon color="disabled" fontSize="small" />
                    </Stack>
                    <Stack spacing={0.5}>
                      <Typography sx={{ fontWeight: 700 }} variant="h3">
                        {title}
                      </Typography>
                      <Typography color="text.secondary" variant="body2">
                        {description}
                      </Typography>
                    </Stack>
                  </Stack>
                </CardContent>
              </CardActionArea>
            </Card>
          ))}
        </Box>
      </Stack>
    </Stack>
  )
}
