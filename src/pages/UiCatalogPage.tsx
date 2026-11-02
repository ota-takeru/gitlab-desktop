import CallMergeRoundedIcon from '@mui/icons-material/CallMergeRounded'
import CheckCircleOutlineRoundedIcon from '@mui/icons-material/CheckCircleOutlineRounded'
import EditNoteRoundedIcon from '@mui/icons-material/EditNoteRounded'
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded'
import HomeRoundedIcon from '@mui/icons-material/HomeRounded'
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined'
import LockRoundedIcon from '@mui/icons-material/LockRounded'
import MarkChatUnreadRoundedIcon from '@mui/icons-material/MarkChatUnreadRounded'
import ScheduleRoundedIcon from '@mui/icons-material/ScheduleRounded'
import RateReviewOutlinedIcon from '@mui/icons-material/RateReviewOutlined'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined'
import SourceOutlinedIcon from '@mui/icons-material/SourceOutlined'
import ThumbUpOutlinedIcon from '@mui/icons-material/ThumbUpOutlined'
import ThumbUpRoundedIcon from '@mui/icons-material/ThumbUpRounded'
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
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useTheme } from '@mui/material/styles'
import { useEffect, useState } from 'react'

import { ClientNavItem } from '../components/ClientNavItem'
import { useConfirm, useNotify } from '../components/feedbackContext'
import { AppErrorFallback } from '../components/AppErrorBoundary'
import { LabelChip } from '../components/LabelChip'
import { ListRow } from '../components/ListRow'
import { MergeRequestStateGlyph, MergeRequestStateIcon } from '../components/MergeRequestStateIcon'
import { Kbd, PaneEmpty, PaneHeader, PaneNavigation, PaneStatus } from '../components/Pane'
import { Pager } from '../components/Pager'
import { PipelineStatus } from '../components/PipelineStatus'
import { RelativeTime } from '../components/RelativeTime'
import { ReactionBar } from '../components/ReactionBar'
import { ResolveToggle } from '../components/ResolveToggle'
import { SettingsSection } from '../components/SettingsSection'
import { StateIcon } from '../components/StateIcon'
import { StatusBar } from '../components/StatusBar'
import { StatusPill } from '../components/StatusPill'
import { NotificationBellIcon, NotificationCount } from '../components/NotificationBellIcon'
import { UpdateNavButton } from '../components/UpdateNavButton'
import { UserAvatar } from '../components/UserAvatar'
import { DiscussionLayout } from '../features/mergeRequests/DiscussionLayout'
import { DiscussionList } from '../features/mergeRequests/DiscussionList'
import { ThreadOutline } from '../features/mergeRequests/ThreadOutline'
import { ReviewComposer } from '../features/mergeRequests/ReviewComposer'
import { NoteBody } from '../features/mergeRequests/SuggestionBlock'
import { DiffViewer } from '../features/mergeRequests/DiffViewer'
import { JobLogLines } from '../features/mergeRequests/JobLog'
import { MergeRequestTab } from '../features/mergeRequests/MergeRequestTabs'
import { useReorder } from '../components/useReorder'
import { KeyboardShortcutsDialog } from '../features/KeyboardShortcutsDialog'
import { ProjectShortcuts } from '../features/projects/ProjectView'
import { GitLabUserAvatar } from '../features/shared/GitLabUserAvatar'
import { UserNavigation, type UserTab } from '../features/users/UserView'
import { GitLabUserLink } from '../components/GitLabUserLink'
import { MarkdownLinkProvider } from '../components/MarkdownLinks'
import type { AwardEmoji } from '../types/gitlab'

/** `section` is the suffix of a `catalog-*` id, e.g. `#foundation/catalog?section=review`. */
export function UiCatalogPage({ section }: { section?: string } = {}) {
  const theme = useTheme()
  useEffect(() => {
    if (section) document.getElementById(`catalog-${section}`)?.scrollIntoView()
  }, [section])
  return (
    <Stack spacing={3.5} sx={{ maxWidth: 1120, mx: 'auto' }}>
      <Stack spacing={1}>
        <Typography component="h1" variant="h1">
          UIカタログ
        </Typography>
        <Typography color="textSecondary" sx={{ maxWidth: 690 }} variant="body1">
          クライアントで共有している部品の一覧です。表示サンプルで、GitLabへの取得・投稿は行いません。
        </Typography>
      </Stack>

      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: { md: 'repeat(2, 1fr)', xs: '1fr' },
        }}
      >
        <Card component="section" id="catalog-status-pills">
          <CardContent sx={{ p: 2.5 }}>
            <Stack spacing={2}>
              <Typography component="h2" variant="h2">
                Status pills
              </Typography>
              <Divider />
              <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
                <StatusPill label="未確認" />
                <StatusPill label="接続済み" tone="success" />
                <StatusPill label="確認中" tone="info" />
                <StatusPill label="未接続" />
                <StatusPill label="エラー" tone="error" />
              </Stack>
            </Stack>
          </CardContent>
        </Card>

        <Card component="section" id="catalog-feedback">
          <CardContent sx={{ p: 2.5 }}>
            <Stack spacing={2}>
              <Typography component="h2" variant="h2">
                Feedback
              </Typography>
              <Divider />
              <Stack spacing={1}>
                <Alert icon={<CheckCircleOutlineRoundedIcon fontSize="inherit" />} severity="success">
                  Rust runtime に接続できました。
                </Alert>
                <Alert icon={<ScheduleRoundedIcon fontSize="inherit" />} severity="info">
                  接続設定を確認しています。
                </Alert>
                <Alert icon={<ErrorOutlineRoundedIcon fontSize="inherit" />} severity="error">
                  接続先を確認できませんでした。
                </Alert>
                <CatalogFeedbackActions />
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      </Box>

      <Card component="section" id="catalog-controls">
        <CardContent sx={{ p: 2.5 }}>
          <Stack spacing={2}>
            <Typography component="h2" variant="h2">
              Controls
            </Typography>
            <Typography color="textSecondary" variant="caption">
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
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}><Chip aria-label="未読 3" color="primary" icon={<MarkChatUnreadRoundedIcon />} label={3} size="small" /><Chip icon={<EditNoteRoundedIcon />} label="Draft" size="small" variant="outlined" /><StatusPill icon={<MergeRequestStateGlyph state="opened" />} label="Open" size="small" subtle tone="success" /></Stack>
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>{/* Label colours are GitLab data; theme colours stand in for them here. */}<LabelChip color={theme.palette.error.main} name="bug" /><LabelChip color={theme.palette.info.main} name="review" /><LabelChip name="色不明のラベル" /></Stack>
          </Stack>
        </CardContent>
      </Card>

      <Card component="section" id="catalog-page-parts">
        <CardContent sx={{ p: 2.5 }}>
          <Stack spacing={2}>
            <Typography component="h2" variant="h2">
              Page parts
            </Typography>
            <Typography color="textSecondary" variant="caption">
              一覧画面の見出し、相対時刻、CI状態、ページ移動の共通表示（サンプル）
            </Typography>
            <Divider />
            <Box sx={{ bgcolor: 'surface.list', border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
              <PaneHeader actions={<IconButton aria-label="更新（サンプル）" disabled><RefreshRoundedIcon /></IconButton>} subtitle="一覧ペインの見出し（サンプル）" title="ペイン見出し" />
              <PaneStatus>2件取得</PaneStatus>
              <Box component="ul" sx={{ m: 0, p: 0 }}>
                <ListRow leading={<MergeRequestStateIcon state="opened" />} onOpen={() => undefined} selected>
                  <Typography color="textSecondary" variant="caption">group/project !12</Typography>
                  <Typography variant="subtitle1">選択中の行（サンプル）</Typography>
                </ListRow>
                <ListRow leading={<MergeRequestStateIcon state="merged" />} onOpen={() => undefined}>
                  <Typography color="textSecondary" variant="caption">group/project !11</Typography>
                  <Typography variant="subtitle1">通常の行（サンプル）</Typography>
                </ListRow>
                <ListRow leading={<MergeRequestStateIcon state="opened" />} onOpen={() => undefined} previewing>
                  <Typography color="textSecondary" variant="caption">group/project !10</Typography>
                  <Typography variant="subtitle1">プレビュー中の行（サンプル）</Typography>
                </ListRow>
              </Box>
            </Box>
            <Box sx={{ bgcolor: 'surface.list', border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
              <PaneHeader actions={<IconButton aria-label="更新（タブ付きサンプル）" disabled><RefreshRoundedIcon /></IconButton>} navigation={<PaneNavigation heading={<Typography component="div" noWrap variant="h1">サンプルの名前</Typography>} tabs={<Tabs aria-label="並列の一覧（サンプル）" value="first"><Tab label="一覧A" value="first" /><Tab label="一覧B" value="second" /></Tabs>} />} title="タブで切り替える一覧（サンプル）" />
              <PaneStatus>並列の一覧は名前の下のタブで切り替える</PaneStatus>
            </Box>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><Kbd>J</Kbd><Kbd>K</Kbd><Typography color="textSecondary" variant="caption">キーボード操作の表示</Typography></Stack>
            <Stack direction="row" sx={{ alignItems: 'center', columnGap: 1.5, flexWrap: 'wrap', rowGap: 0.5 }}>
              <RelativeTime prefix="更新" value="2026-01-01T09:00:00.000Z" />
              <PipelineStatus status="success" />
              <PipelineStatus status="failed" />
              <PipelineStatus status="running" />
              <PipelineStatus status="manual" />
              <PipelineStatus status={null} />
              <PipelineStatus prefix="" status="canceled" />
            </Stack>
            <Typography color="textSecondary" variant="caption">一覧の行では状態を文字ではなく形・色・数で示す（名前はツールチップ）</Typography>
            <Stack direction="row" sx={{ alignItems: 'center', columnGap: 1.5, flexWrap: 'wrap', rowGap: 0.5 }}>
              <MergeRequestStateIcon state="opened" />
              <StateIcon icon={<EditNoteRoundedIcon fontSize="inherit" />} label="Draft" />
              <PipelineStatus compact status="success" />
              <PipelineStatus compact status="failed" />
              <PipelineStatus compact status="running" />
              <PipelineStatus compact status="manual" />
              <StateIcon count={0} icon={<ThumbUpOutlinedIcon fontSize="inherit" />} label="未承認" />
              <StateIcon count={2} icon={<ThumbUpOutlinedIcon fontSize="inherit" />} label="2人が承認済み" tone="success" />
              <StateIcon count={2} icon={<ThumbUpRoundedIcon fontSize="inherit" />} label="自分が承認済み" tone="success" />
              <StateIcon icon={<HomeRoundedIcon fontSize="inherit" />} label="デフォルト" tone="info" />
              <StateIcon icon={<LockRoundedIcon fontSize="inherit" />} label="保護" tone="warning" />
              <StateIcon icon={<CallMergeRoundedIcon fontSize="inherit" />} label="マージ済み" tone="secondary" />
              <StateIcon icon={<Inventory2OutlinedIcon fontSize="inherit" />} label="アーカイブ済み" />
            </Stack>
            <Pager hasNext hasPrevious onNext={() => undefined} onPrevious={() => undefined} page={2} summary="20件取得" />
          </Stack>
        </CardContent>
      </Card>

      <Card component="section" id="catalog-error-recovery">
        <CardContent>
          <Typography component="h2" variant="h2">画面エラーからの復旧</Typography>
          <AppErrorFallback compact onGoToConnectionSettings={() => undefined} onRetry={() => undefined} retryCount={1} />
        </CardContent>
      </Card>
      <Stack id="catalog-review" spacing={1.5}>
        <Typography component="h2" variant="h2">レビュー入力と差分</Typography>
        <Typography color="textSecondary" variant="caption">表示サンプルです。GitLabへの取得・投稿は行いません。</Typography>
        <ReviewComposer disabled value="MR全体へのコメントの表示例です。" onChange={() => undefined} onCancelReply={() => undefined} onClearPosition={() => undefined} onSaveDraft={async () => false} onSubmitComment={async () => false} onUploadAttachment={async () => null} />
        <DiscussionLayout composer={null} navigator={<ThreadOutline discussions={[catalogDiscussion]} filter="all" olderNotLoaded={false} onSelect={() => undefined} unreadNoteIds={[]} />} side={null} threads={<CatalogReplyThread />} />
        <JobLogLines label="ジョブログ（サンプル）" lines={[[{ bold: true, fg: 'cyan', text: 'Preparing the "docker" executor' }], [{ bold: true, fg: 'green', text: '$ npm test' }], [{ text: '  ✓ 12 tests passed' }], [{ fg: 'yellow', text: 'warning: deprecated option' }], [{ bold: true, fg: 'red', text: 'ERROR: Job failed: exit code 1' }]]} />
        <DiffViewer reviewContext={{ instanceUrl: "https://catalog.invalid", userId: "catalog", projectId: "example", mergeRequestIid: "1", revision: "catalog-v1" }} allowComments diffs={[catalogDiff]} lineComposer={{ position: catalogPosition, node: <ReviewComposer disabled inlineTarget suggestionLines={() => null} targetPosition={catalogPosition} value="変更の意図を確認する複数行コメントの表示例です。" onChange={() => undefined} onCancelReply={() => undefined} onClearPosition={() => undefined} onSaveDraft={async () => false} onSubmitComment={async () => false} /> }} selectedFile="example.ts" selectedPosition={catalogPosition} view="diff" onComment={() => undefined} onSelectFile={() => undefined} onViewChange={() => undefined} />
        <Box sx={{ maxWidth: 760 }}><NoteBody actions={{ currentUserId: 'catalog', disabled: true, headSha: null, onApply: async () => false }} note={catalogSuggestionNote} /></Box>
      </Stack>

      <Card component="section" id="catalog-empty-state">
        <CardContent sx={{ p: 2.5 }}>
          <Stack spacing={2}>
            <Typography component="h2" variant="h2">PaneEmpty</Typography>
            <Typography color="textSecondary" variant="caption">一覧ペインが空・未選択のときの表示（サンプル）</Typography>
            <Divider />
            <Box sx={{ bgcolor: 'surface.list', border: 1, borderColor: 'divider', borderRadius: 1 }}>
              <PaneEmpty description="検索条件を変えるか、別のページを取得してください。" icon={<SourceOutlinedIcon fontSize="inherit" />} title="表示するデータがありません">
                <Button variant="outlined">条件をクリア</Button>
              </PaneEmpty>
            </Box>
          </Stack>
        </CardContent>
      </Card>

      <CatalogFrameParts />
    </Stack>
  )
}

const catalogDiff = { oldPath: 'example.ts', newPath: 'example.ts', diff: '@@ -1,5 +1,6 @@\n /** Feature flags read at startup. */\n-export const enabled = false\n+export const enabled = true\n+const retries = 3\n export function label(name: string): string {\n-  return `flag: ${name}`\n+  return `flag: ${name} (${retries})`\n }', newFile: false, deletedFile: false, renamedFile: false, tooLarge: false, collapsed: false }
/** A comment on new lines 2–5, shown as a chosen range with its editor under line 5. */
const catalogPosition = { baseSha: '', headSha: '', lineRange: { end: { newLine: 5, newPosition: 5, oldPosition: 5 }, hunk: { newCount: 6, newStart: 1, oldCount: 5, oldStart: 1 }, start: { newLine: 2, newPosition: 2, oldPosition: 3 } }, newLine: 5, newPath: 'example.ts', oldPath: 'example.ts', positionType: 'text' as const, startSha: '' }
const catalogSuggestionNote = {
  author: { id: 'catalog-reviewer', name: '検証ユーザー', username: 'sample' },
  body: 'リトライ回数は表示しない方が読みやすそうです。\n\n```suggestion\n  return `flag: ${name}`\n```',
  suggestions: [{ appliable: true, applied: false, fromContent: '  return `flag: ${name} (${retries})`\n', fromLine: 5, id: '1', toContent: '  return `flag: ${name}`\n', toLine: 5 }],
}

const catalogAuthor = { id: 'catalog-reviewer', name: 'Reviewer', username: 'reviewer' }
const catalogDiscussion = {
  id: 'catalog-thread',
  individualNote: false,
  notes: [{ author: catalogAuthor, body: '**この条件**は `null` のときも通りますか？', createdAt: '2026-01-05T09:00:00Z', id: 'catalog-note', position: null, resolvable: true, resolved: false, system: false }],
}

/** A thread with its reply editor; nothing is sent to GitLab. */
function CatalogReplyThread() {
  const [replying, setReplying] = useState(false)
  const [body, setBody] = useState('')
  return (
    <DiscussionList
      currentUserId="catalog-user"
      discussions={[catalogDiscussion]}
      onDelete={async () => false}
      onEdit={async () => false}
      onReply={() => setReplying(true)}
      onResolve={async () => false}
      replyComposer={<ReviewComposer onCancelReply={() => setReplying(false)} onChange={setBody} onClearPosition={() => undefined} onSaveDraft={async () => false} onSubmitComment={async () => false} onUploadAttachment={async () => null} replyAuthor={catalogAuthor.name} replyDiscussionId={catalogDiscussion.id} value={body} />}
      replyDiscussionId={replying ? catalogDiscussion.id : undefined}
    />
  )
}

/** The themed confirmation, the undo notice and the shortcut list; nothing is sent to GitLab. */
function CatalogFeedbackActions() {
  const confirm = useConfirm()
  const notify = useNotify()
  const [shortcuts, setShortcuts] = useState(false)
  return (
    <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
      <Button onClick={() => void confirm({ confirmLabel: '破棄する', destructive: true, message: '確認ダイアログの表示例です。', title: '入力を破棄しますか？' })} variant="outlined">確認ダイアログ</Button>
      <Button onClick={() => notify({ actionLabel: '元に戻す', message: '入力を破棄しました', onAction: () => undefined })} variant="outlined">元に戻す通知</Button>
      <Button onClick={() => setShortcuts(true)} variant="outlined">ショートカット一覧</Button>
      <KeyboardShortcutsDialog onClose={() => setShortcuts(false)} open={shortcuts} />
    </Stack>
  )
}

const catalogProjects: Record<string, { name: string; pathWithNamespace: string }> = {
  '101': { name: 'desktop-client', pathWithNamespace: 'platform/desktop-client' },
  '102': { name: 'api-gateway', pathWithNamespace: 'platform/api-gateway' },
  '103': { name: 'docs', pathWithNamespace: 'handbook/docs' },
}

/** The client's frame: navigation items, settings blocks, the status bar, avatars and small markers. */
function CatalogFrameParts() {
  const [resolved, setResolved] = useState(false)
  return (
    <>
      <Card component="section" id="catalog-sidebar">
        <CardContent sx={{ p: 2.5 }}>
          <Stack spacing={2}>
            <Typography component="h2" variant="h2">サイドバーの項目</Typography>
            <Typography color="textSecondary" variant="caption">場所の項目（選択中・通常・未接続で無効）、件数を控えめなタグで示す通知ボタン（展開時は行末、折りたたみ時はベルと並べる。あり・なし・開いている・10件以上・続きあり）、折りたたみ時のアイコン表示、更新があるときだけ出る更新ボタン（入力の保存待ちで無効）、下端のアカウントと設定（サンプル）</Typography>
            <Divider />
            <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start' }}>
              <Box sx={{ bgcolor: 'surface.nav', border: 1, borderColor: 'divider', borderRadius: 1, p: 1, width: 208 }}>
                <ClientNavItem collapsed={false} icon={<RateReviewOutlinedIcon />} label="MR一覧" onClick={() => undefined} selected title="MR一覧" />
                <ClientNavItem collapsed={false} disabled icon={<SourceOutlinedIcon />} label="プロジェクト" onClick={() => undefined} selected={false} title="プロジェクト" />
                <ClientNavItem collapsed={false} expanded={false} icon={<NotificationBellIcon count={3} withCount={false} />} label="通知" onClick={() => undefined} selected={false} title="通知 3件" trailing={<NotificationCount count={3} />} />
                <ClientNavItem collapsed={false} expanded icon={<NotificationBellIcon count={0} />} label="通知" onClick={() => undefined} selected title="通知" />
                <UpdateNavButton collapsed={false} onClick={() => undefined} version="0.8.0" />
                <UpdateNavButton collapsed={false} disabledReason="入力の保存または破棄と送信処理の確認が済むと更新できます。" onClick={() => undefined} version="0.8.0" />
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', borderTop: 1, borderColor: 'divider', color: 'text.secondary', minHeight: 40, mt: 1, px: 1 }}>
                  <UserAvatar id="a" name="Reviewer" size={24} />
                  <Typography color="inherit" noWrap sx={{ flex: 1, minWidth: 0 }} variant="caption">@reviewer</Typography>
                  <SettingsOutlinedIcon sx={{ fontSize: 18 }} />
                </Stack>
              </Box>
              <Box sx={{ bgcolor: 'surface.nav', border: 1, borderColor: 'divider', borderRadius: 1, p: 1, width: 52 }}>
                <ClientNavItem collapsed icon={<RateReviewOutlinedIcon />} label="MR一覧" onClick={() => undefined} selected title="MR一覧" />
                <ClientNavItem collapsed icon={<SourceOutlinedIcon />} label="プロジェクト" onClick={() => undefined} selected={false} title="プロジェクト" />
                <ClientNavItem collapsed expanded={false} icon={<NotificationBellIcon count={12} />} label="通知" onClick={() => undefined} selected={false} title="通知 12件" />
                <ClientNavItem collapsed expanded={false} icon={<NotificationBellIcon count={4} more />} label="通知" onClick={() => undefined} selected={false} title="通知 4件以上" />
                <UpdateNavButton collapsed onClick={() => undefined} version="0.8.0" />
                <Stack sx={{ alignItems: 'center', borderTop: 1, borderColor: 'divider', color: 'text.secondary', justifyContent: 'center', minHeight: 40, mt: 1 }}>
                  <SettingsOutlinedIcon sx={{ fontSize: 20 }} />
                </Stack>
              </Box>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      <Card component="section" id="catalog-status-bar">
        <CardContent sx={{ p: 2.5 }}>
          <Stack spacing={2}>
            <Typography component="h2" variant="h2">ステータスバー</Typography>
            <Typography color="textSecondary" variant="caption">24px高の下部ステータスバー。接続済み・接続の問題・未接続（サンプル）</Typography>
            <Divider />
            <Stack spacing={1}>
              <StatusBar tone="connected" trailing={<Typography color="textSecondary" noWrap variant="caption">v0.7.0</Typography>}>接続済み · https://gitlab.example.com · @reviewer</StatusBar>
              <StatusBar tone="warning">GitLabに接続できません · 保存済みデータを表示中 · https://gitlab.example.com</StatusBar>
              <StatusBar tone="disconnected">未接続 · データは表示していません</StatusBar>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      <Card component="section" id="catalog-settings-section">
        <CardContent sx={{ p: 2.5 }}>
          <Stack spacing={2}>
            <Typography component="h2" variant="h2">SettingsSection</Typography>
            <Box>
              <SettingsSection description="この端末での配色" id="sample-settings-display" title="表示">
                <Typography color="textSecondary" variant="body2">設定画面の各ブロックは罫線で区切り、カードにしない（サンプル）。</Typography>
              </SettingsSection>
            </Box>
          </Stack>
        </CardContent>
      </Card>

      <Card component="section" id="catalog-user-navigation">
        <CardContent sx={{ p: 2.5 }}>
          <Stack spacing={2}>
            <Typography component="h2" variant="h2">ユーザーの一覧</Typography>
            <CatalogUserNavigation />
          </Stack>
        </CardContent>
      </Card>
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { md: 'repeat(2, 1fr)', xs: '1fr' } }}>
        <Card component="section" id="catalog-avatars">
          <CardContent sx={{ p: 2.5 }}>
            <Stack spacing={2}>
              <Typography component="h2" variant="h2">アバター</Typography>
              <Typography color="textSecondary" variant="caption">画像がないときの頭文字（4色）と、GitLabの画像を取得していないときの表示</Typography>
              <Divider />
              <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                {catalogAvatarUsers.map((user) => <UserAvatar id={user.id} key={user.id} name={user.name} />)}
                <UserAvatar id="a" name="Aoki" size={24} />
                <GitLabUserAvatar sessionId={null} user={{ id: 'catalog-user', name: '検証ユーザー', username: 'sample' }} />
              </Stack>
            </Stack>
          </CardContent>
        </Card>

        <Card component="section" id="catalog-mr-state-icons">
          <CardContent sx={{ p: 2.5 }}>
            <Stack spacing={2}>
              <Typography component="h2" variant="h2">MergeRequestStateIcon</Typography>
              <Typography color="textSecondary" variant="caption">サイドバーのタブで使うMRの状態</Typography>
              <Divider />
              <Stack direction="row" sx={{ alignItems: 'center', columnGap: 2, flexWrap: 'wrap', rowGap: 1 }}>
                {['opened', 'merged', 'closed', 'unknown'].map((state) => <Stack direction="row" key={state} spacing={0.5} sx={{ alignItems: 'center' }}><MergeRequestStateIcon state={state} /><Typography color="textSecondary" variant="caption">{state}</Typography></Stack>)}
              </Stack>
            </Stack>
          </CardContent>
        </Card>

        <Card component="section" id="catalog-project-shortcuts">
          <CardContent sx={{ p: 2.5 }}>
            <Stack spacing={2}>
              <Typography component="h2" variant="h2">プロジェクトのショートカット</Typography>
              <Typography color="textSecondary" variant="caption">お気に入りと最近開いたプロジェクト（サンプル）</Typography>
              <Divider />
              <Box sx={{ bgcolor: 'surface.list', border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
                <ProjectShortcuts ids={['101', '102']} label="お気に入り" labelOf={(id) => catalogProjects[id]} onOpen={() => undefined} secondaryIds={['103', '104']} secondaryLabel="最近" />
              </Box>
            </Stack>
          </CardContent>
        </Card>

        <Card component="section" id="catalog-resolve-toggle">
          <CardContent sx={{ p: 2.5 }}>
            <Stack spacing={2}>
              <Typography component="h2" variant="h2">ResolveToggle</Typography>
              <Typography color="textSecondary" variant="caption">スレッドの解決状態の表示と切り替えを兼ねるボタン</Typography>
              <Divider />
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <ResolveToggle onToggle={setResolved} resolved={resolved} />
                <ResolveToggle onToggle={() => undefined} resolved />
                <ResolveToggle onToggle={() => undefined} pending resolved={false} />
              </Stack>
            </Stack>
          </CardContent>
        </Card>

        <Card component="section" id="catalog-reaction-bar">
          <CardContent sx={{ p: 2.5 }}>
            <Stack spacing={2}>
              <Typography component="h2" variant="h2">ReactionBar</Typography>
              <Typography color="textSecondary" variant="caption">コメントとMR説明の絵文字リアクション。自分が付けたものは選択状態、ツールチップに付けた人（サンプル）。＋で検索・分類・グリッドの絵文字ピッカーを開く</Typography>
              <Divider />
              <CatalogReactions />
              <ReactionBar awards={[]} currentUserId="42" disabled label="リアクションのないコメント" onToggle={() => undefined} />
            </Stack>
          </CardContent>
        </Card>

        <Card component="section" id="catalog-mr-tabs">
          <CardContent sx={{ p: 2.5 }}>
            <Stack spacing={2}>
              <Typography component="h2" variant="h2">サイドバーのMRタブ</Typography>
              <Typography color="textSecondary" variant="caption">固定（ピンを常に表示）・開いている・選択中、展開時と折りたたみ時（サンプル）</Typography>
              <Divider />
              <CatalogMrTabs />
            </Stack>
          </CardContent>
        </Card>
      </Box>
    </>
  )
}

const catalogTabs = [
  { mrRef: { projectId: '101', iid: '42' }, pinned: true, meta: { title: 'MR一覧の検索結果をSQLiteキャッシュから再利用する', state: 'opened', projectPath: 'platform/desktop-client' } },
  { mrRef: { projectId: '101', iid: '39' }, pinned: false, meta: { title: '差分ビューの行描画を可視範囲だけに制限する', state: 'opened', projectPath: 'platform/desktop-client' } },
  { mrRef: { projectId: '7', iid: '64' }, pinned: false, meta: { title: 'レビュー検索用のローカルインデックスを追加する', state: 'merged', projectPath: 'data/catalog' } },
]

function CatalogReactions() {
  const me = { id: '42', name: '自分', username: 'me' }
  const [awards, setAwards] = useState<AwardEmoji[]>([
    { name: 'thumbsup', user: { id: '7', name: '佐藤', username: 'sato' } },
    { name: 'thumbsup', user: me },
    { name: 'eyes', user: { id: '8', name: '鈴木', username: 'suzuki' } },
    { name: 'sushi', user: { id: '8', name: '鈴木', username: 'suzuki' } },
    { name: 'party_parrot', user: { id: '7', name: '佐藤', username: 'sato' } },
  ])
  return <ReactionBar awards={awards} currentUserId={me.id} label="サンプルのコメント" onToggle={(name, add) => setAwards((current) => add ? [...current, { name, user: me }] : current.filter((award) => !(award.name === name && award.user.id === me.id)))} />
}

function CatalogMrTabs() {
  const reorder = useReorder({ axis: 'y', keys: catalogTabs.map((tab) => `${tab.mrRef.projectId}-${tab.mrRef.iid}`), onMove: () => undefined })
  const tabs = (collapsed: boolean) => (
    <Box component="ul" sx={{ bgcolor: 'surface.nav', border: 1, borderColor: 'divider', borderRadius: 1, m: 0, p: 1, width: collapsed ? 52 : 208 }}>
      {catalogTabs.map((tab, index) => <MergeRequestTab collapsed={collapsed} key={tab.mrRef.iid} meta={tab.meta} mrRef={tab.mrRef} onClose={tab.pinned ? undefined : () => undefined} onOpen={() => undefined} onTogglePin={() => undefined} pinned={tab.pinned} reorder={reorder} selected={index === 1} />)}
    </Box>
  )
  return <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start' }}>{tabs(false)}{tabs(true)}</Stack>
}

/** Ids whose character sums fall on each of the four avatar tones. */
const catalogAvatarUsers = [
  { id: 'a', name: 'Aoki' },
  { id: 'b', name: 'Baba' },
  { id: 'c', name: 'Chiba' },
  { id: 'd', name: 'Doi' },
]

function CatalogUserNavigation() {
  const [tab, setTab] = useState<UserTab>('mrs')
  const user = { id: '7', name: '検証ユーザー', username: 'sample' }
  return <MarkdownLinkProvider instanceUrl="https://fixture.invalid" open={() => setTab('mrs')}>
    <Typography variant="body2">コメントの作成者: <GitLabUserLink user={user} /></Typography>
    <PaneHeader navigation={<UserNavigation onTabChange={setTab} tab={tab} user={user} />} title={tab === 'mrs' ? '作成したMR' : 'プロジェクト'} />
  </MarkdownLinkProvider>
}
