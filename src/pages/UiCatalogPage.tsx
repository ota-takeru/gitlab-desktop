import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlined'
import CodeOutlinedIcon from '@mui/icons-material/CodeOutlined'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlined'
import PendingOutlinedIcon from '@mui/icons-material/PendingOutlined'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import Alert from '@mui/material/Alert'
import Autocomplete from '@mui/material/Autocomplete'
import Chip from '@mui/material/Chip'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'

import { EmptyState } from '../components/EmptyState'
import { AppErrorFallback } from '../components/AppErrorBoundary'
import { ListRow } from '../components/ListRow'
import { MergeRequestStateIcon } from '../components/MergeRequestStateIcon'
import { Kbd, PaneHeader, PaneStatus } from '../components/Pane'
import { Pager } from '../components/Pager'
import { PipelineStatus } from '../components/PipelineStatus'
import { RelativeTime } from '../components/RelativeTime'
import { StatusPill } from '../components/StatusPill'
import { ReviewComposer } from '../features/mergeRequests/ReviewComposer'
import { DiffViewer } from '../features/mergeRequests/DiffViewer'

export function UiCatalogPage() {
  return (
    <Stack spacing={3.5} sx={{ maxWidth: 1120, mx: 'auto' }}>
      <Stack spacing={1}>
        <Typography color="primary.main" sx={{ fontWeight: 800 }} variant="overline">
          Foundation
        </Typography>
        <Typography component="h1" variant="h1">
          UI catalog
        </Typography>
        <Typography color="text.secondary" sx={{ maxWidth: 690 }} variant="body1">
          画面ごとの表現を揃えるための小さなカタログです。接続状態と空状態を同じ部品で扱います。
        </Typography>
      </Stack>

      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: { md: 'repeat(2, 1fr)', xs: '1fr' },
        }}
      >
        <Card component="section">
          <CardContent sx={{ p: 2.5 }}>
            <Stack spacing={2}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <CodeOutlinedIcon color="primary" fontSize="small" />
                <Typography component="h2" variant="h2">
                  Status pills
                </Typography>
              </Stack>
              <Divider />
              <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
                <StatusPill label="未確認" />
                <StatusPill label="接続済み" tone="success" />
                <StatusPill label="確認中" tone="info" />
                <StatusPill label="未接続" tone="warning" />
                <StatusPill label="エラー" tone="error" />
              </Stack>
            </Stack>
          </CardContent>
        </Card>

        <Card component="section">
          <CardContent sx={{ p: 2.5 }}>
            <Stack spacing={2}>
              <Typography component="h2" variant="h2">
                Feedback
              </Typography>
              <Divider />
              <Stack spacing={1}>
                <Alert icon={<CheckCircleOutlineIcon fontSize="inherit" />} severity="success">
                  Rust runtime に接続できました。
                </Alert>
                <Alert icon={<PendingOutlinedIcon fontSize="inherit" />} severity="info">
                  接続設定を確認しています。
                </Alert>
                <Alert icon={<ErrorOutlineIcon fontSize="inherit" />} severity="error">
                  接続先を確認できませんでした。
                </Alert>
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      </Box>

      <Card component="section">
        <CardContent sx={{ p: 2.5 }}>
          <Stack spacing={2}>
            <Typography component="h2" variant="h2">
              Controls
            </Typography>
            <Typography color="text.secondary" variant="caption">
              表示サンプル（設定は保存されません）
            </Typography>
            <Divider />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <TextField disabled label="GitLab URL" placeholder="接続後に設定" sx={{ flex: 1 }} />
              <Button disabled variant="contained">
                保存
              </Button>
              <Button disabled variant="outlined">
                キャンセル
              </Button>
            </Stack>
            <Autocomplete disabled getOptionLabel={(option) => option.name} options={[{ id: '42', name: '検証ユーザー @sample' }]} renderInput={(params) => <TextField {...params} label="ユーザー候補（サンプル）" />} size="small" />
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}><Chip color="info" label="未読 3" size="small" variant="outlined" /><Chip label="Draft" size="small" variant="outlined" /><StatusPill label="Open" size="small" subtle tone="success" /></Stack>
          </Stack>
        </CardContent>
      </Card>

      <Card component="section">
        <CardContent sx={{ p: 2.5 }}>
          <Stack spacing={2}>
            <Typography component="h2" variant="h2">
              Page parts
            </Typography>
            <Typography color="text.secondary" variant="caption">
              一覧画面の見出し、相対時刻、CI状態、ページ移動の共通表示（サンプル）
            </Typography>
            <Divider />
            <Box sx={{ bgcolor: 'surface.list', border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
              <PaneHeader actions={<IconButton aria-label="更新（サンプル）" disabled><RefreshRoundedIcon /></IconButton>} subtitle="一覧ペインの見出し（サンプル）" title="ペイン見出し" />
              <PaneStatus>2件取得</PaneStatus>
              <Box component="ul" sx={{ m: 0, p: 0 }}>
                <ListRow leading={<MergeRequestStateIcon state="opened" />} onOpen={() => undefined} selected>
                  <Typography color="text.secondary" variant="caption">group/project !12</Typography>
                  <Typography sx={{ fontWeight: 600 }} variant="body2">選択中の行（サンプル）</Typography>
                </ListRow>
                <ListRow leading={<MergeRequestStateIcon state="merged" />} onOpen={() => undefined}>
                  <Typography color="text.secondary" variant="caption">group/project !11</Typography>
                  <Typography sx={{ fontWeight: 500 }} variant="body2">通常の行（サンプル）</Typography>
                </ListRow>
              </Box>
            </Box>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><Kbd>J</Kbd><Kbd>K</Kbd><Typography color="text.secondary" variant="caption">キーボード操作の表示</Typography></Stack>
            <Stack direction="row" sx={{ alignItems: 'center', columnGap: 1.5, flexWrap: 'wrap', rowGap: 0.5 }}>
              <RelativeTime prefix="更新" value="2026-01-01T09:00:00.000Z" />
              <PipelineStatus status="success" />
              <PipelineStatus status="failed" />
              <PipelineStatus status="running" />
              <PipelineStatus status="manual" />
              <PipelineStatus status={null} />
            </Stack>
            <Pager hasNext hasPrevious onNext={() => undefined} onPrevious={() => undefined} page={2} summary="20件取得" />
          </Stack>
        </CardContent>
      </Card>

      <Card component="section">
        <CardContent>
          <Typography component="h2" variant="h2">画面エラーからの復旧</Typography>
          <AppErrorFallback compact onGoToConnectionSettings={() => undefined} onRetry={() => undefined} retryCount={1} />
        </CardContent>
      </Card>
      <Stack spacing={1.5}>
        <Typography component="h2" variant="h2">レビュー入力と差分</Typography>
        <Typography color="text.secondary" variant="caption">表示サンプルです。GitLabへの取得・投稿は行いません。</Typography>
        <ReviewComposer disabled value="変更の意図を確認するコメントの表示例です。" onChange={() => undefined} onCancelReply={() => undefined} onClearPosition={() => undefined} onSaveDraft={async () => false} onSubmitComment={async () => false} />
        <DiffViewer allowComments={false} diffs={[{ oldPath: 'example.ts', newPath: 'example.ts', diff: '@@ -1 +1 @@\n-export const enabled = false\n+export const enabled = true', newFile: false, deletedFile: false, renamedFile: false, tooLarge: false, collapsed: false }]} selectedFile="example.ts" selectedPosition={undefined} view="diff" onComment={() => undefined} onSelectFile={() => undefined} onViewChange={() => undefined} />
      </Stack>

      <Stack spacing={1.5}>
        <Typography component="h2" variant="h2">
          Empty state
        </Typography>
        <EmptyState
          description="接続後に、対象がないときの説明と次の行動をこのレイアウトで表示します。"
          title="表示するデータがありません"
        />
      </Stack>
    </Stack>
  )
}
