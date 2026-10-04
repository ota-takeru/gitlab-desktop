import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlined'
import CodeOutlinedIcon from '@mui/icons-material/CodeOutlined'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlined'
import PendingOutlinedIcon from '@mui/icons-material/PendingOutlined'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Divider from '@mui/material/Divider'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'

import { EmptyState } from '../components/EmptyState'
import { AppErrorFallback } from '../components/AppErrorBoundary'
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
