import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined'
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded'
import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined'
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined'
import MergeTypeOutlinedIcon from '@mui/icons-material/MergeTypeOutlined'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardActionArea from '@mui/material/CardActionArea'
import CardContent from '@mui/material/CardContent'
import Divider from '@mui/material/Divider'
import Dialog from '@mui/material/Dialog'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Drawer from '@mui/material/Drawer'
import IconButton from '@mui/material/IconButton'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'

import { HealthPanel } from '../components/HealthPanel'
import { StatusPill } from '../components/StatusPill'
import { UpdatePanel } from '../components/UpdatePanel'
import { clearLocalDrafts } from '../lib/localDrafts'
import type { MergeRequest, Project } from '../types/gitlab'
import { ConnectionProvider, useConnection } from './connections/ConnectionProvider'
import { ConnectionView } from './connections/ConnectionView'
import { clearComposerBuffers, MergeRequestDetail } from './mergeRequests/MergeRequestDetail'
import { clearGitLabCache } from '../lib/gitlab'
import { clearComposerBufferStore, flushComposerBuffers } from './mergeRequests/useComposerBuffer'
import { WindowCloseProtection } from '../components/WindowCloseProtection'
import { MergeRequestList } from './mergeRequests/MergeRequestList'
import { ProjectView } from './projects/ProjectView'
import { AutoUpdateSafetyProvider, useAutoUpdateAllowed } from './shared/AutoUpdateSafety'
import { clearGitLabMutationStates } from './shared/useGitLabMutation'
import { useGitLabQuery } from './shared/useGitLabQuery'

const UiCatalogPage = lazy(() => import('../pages/UiCatalogPage').then(({ UiCatalogPage: Page }) => ({ default: Page })))

type ClientRoute = 'home' | 'projects' | 'mrs' | 'settings' | 'catalog' | 'mr'

export function ClientApp({ mode, onModeChange }: { mode: 'light' | 'dark'; onModeChange: () => void }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, retry: false, staleTime: 30_000 } } }))
  useEffect(() => {
    const handleWorkspaceReset = () => clearComposerBuffers()
    globalThis.addEventListener('gitlab-explicit-logout', handleWorkspaceReset)
    globalThis.addEventListener('gitlab-account-replaced', handleWorkspaceReset)
    return () => {
      globalThis.removeEventListener('gitlab-explicit-logout', handleWorkspaceReset)
      globalThis.removeEventListener('gitlab-account-replaced', handleWorkspaceReset)
    }
  }, [])
  return <QueryClientProvider client={queryClient}><ConnectionProvider><SessionScopedWorkspace mode={mode} onModeChange={onModeChange} /></ConnectionProvider></QueryClientProvider>
}

function SessionScopedWorkspace({ mode, onModeChange }: { mode: 'light' | 'dark'; onModeChange: () => void }) {
  const { session, status } = useConnection()
  const queryClient = useQueryClient()
  const previousSessionId = useRef<string | null>(null)
  const sessionKey = session?.id ?? null
  useEffect(() => {
    const previous = previousSessionId.current
    if (previous && previous !== sessionKey) {
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] === 'gitlab' && query.queryKey[1] === previous })
    }
    previousSessionId.current = sessionKey
  }, [queryClient, sessionKey])
  return <AutoUpdateSafetyProvider><SessionWorkspaceContents mode={mode} onModeChange={onModeChange} status={status} sessionKey={session ? `${session.instanceUrl}:${session.user.id}:${session.id}` : 'disconnected'} /></AutoUpdateSafetyProvider>
}

function SessionWorkspaceContents({ mode, onModeChange, sessionKey, status }: { mode: 'light' | 'dark'; onModeChange: () => void; sessionKey: string; status: string }) {
  const autoInstallAllowed = useAutoUpdateAllowed() && status !== 'checking'
  // Updates belong to the application lifetime. Authentication expiry may reset
  // the private workspace while a download is running, but must retain its guard.
    return <Box sx={{ bgcolor: 'background.default', display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <WindowCloseProtection />
    <Box sx={{ flexShrink: 0, ml: '224px', px: { md: 3, xs: 2 }, py: 1 }}><UpdatePanel autoInstallAllowed={autoInstallAllowed} compact /></Box>
    <ClientWorkspace key={sessionKey} mode={mode} onModeChange={onModeChange} />
  </Box>
}

function ClientWorkspace({ mode, onModeChange }: { mode: 'light' | 'dark'; onModeChange: () => void }) {
  const { session } = useConnection()
  const [location, setLocation] = useState(() => readClientLocation())
  const [mergeRequest, setMergeRequest] = useState<MergeRequest | null>(null)
  const [returnHash, setReturnHash] = useState<string>('#client/mrs')

  const navigate = (nextRoute: ClientRoute, params?: Record<string, string>) => {
    const query = params ? `?${new URLSearchParams(params).toString()}` : ''
    window.location.hash = `client/${nextRoute}${query}`
    setLocation(readClientLocation())
  }

  useEffect(() => () => {
    clearGitLabMutationStates(session?.id)
  }, [session?.id])

  useEffect(() => {
    const handleHashChange = () => setLocation(readClientLocation())
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') return
      event.preventDefault()
      if (location.route !== 'projects' && location.route !== 'mrs') {
        navigate('mrs')
        globalThis.setTimeout(() => globalThis.dispatchEvent(new Event('gitlab-focus-project-search')), 0)
      } else {
        globalThis.dispatchEvent(new Event('gitlab-focus-project-search'))
      }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [location.route])

  const openProject = (nextProject: Project) => {
    navigate('mrs', { projectId: nextProject.id, projectName: nextProject.name })
  }

  const openProjectId = (nextProjectId: string) => {
    navigate('mrs', { projectId: nextProjectId })
  }

  const updateMergeRequestLocation = (params: Record<string, string>) => {
    const nextParams = location.params.projectName ? { ...params, projectName: location.params.projectName } : params
    const query = new URLSearchParams(nextParams).toString()
    const hash = `#client/mrs${query ? `?${query}` : ''}`
    window.history.replaceState(window.history.state, '', hash)
    setLocation(readClientLocation())
  }

  const openMergeRequest = (nextMergeRequest: MergeRequest) => {
    setReturnHash(window.location.hash || '#client/mrs')
    setMergeRequest(nextMergeRequest)
    navigate('mr', { iid: nextMergeRequest.iid, projectId: nextMergeRequest.projectId })
  }

  const { route } = location
  const pageTitle = route === 'home' ? 'GitLab Desktop' : route === 'projects' ? 'Projects' : route === 'mrs' ? 'Merge requests' : route === 'mr' ? 'Merge request' : route === 'settings' ? '接続設定' : 'UI catalog'

  return (
    <Box sx={{ bgcolor: 'background.default', display: 'flex', flex: 1, minHeight: 0 }}>
      <Drawer
        slotProps={{ paper: { component: 'aside' } }}
        sx={{ flexShrink: 0, width: 224, '& .MuiDrawer-paper': { bgcolor: 'background.paper', borderColor: 'divider', boxSizing: 'border-box', width: 224 } }}
        variant="permanent"
      >
        <Stack sx={{ height: '100%', p: 1.5 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', px: 0.75, py: 1 }}>
            <Box sx={{ alignItems: 'center', bgcolor: 'primary.main', borderRadius: 1, color: 'primary.contrastText', display: 'flex', height: 30, justifyContent: 'center', width: 30 }}><MergeTypeOutlinedIcon fontSize="small" /></Box>
            <Typography sx={{ fontWeight: 700 }} variant="body2">GitLab Desktop</Typography>
          </Stack>
          <Box component="nav" aria-label="GitLab client navigation" sx={{ flex: 1, mt: 2 }}>
            <List disablePadding>
              <ClientNavItem icon={<HomeOutlinedIcon fontSize="small" />} label="ホーム" onClick={() => navigate('home')} selected={route === 'home'} />
              <ClientNavItem icon={<FolderOpenRoundedIcon fontSize="small" />} label="プロジェクト" onClick={() => navigate('projects')} selected={route === 'projects'} />
              <ClientNavItem ariaLabel="Merge requests レビュー待ち" icon={<SearchRoundedIcon fontSize="small" />} label="レビュー待ち" onClick={() => navigate('mrs', { reviewer: 'self', state: 'opened' })} selected={route === 'mrs' && location.params.reviewer === 'self' && location.params.state === 'opened'} />
              <ClientNavItem icon={<SearchRoundedIcon fontSize="small" />} label="MR検索" onClick={() => navigate('mrs')} selected={(route === 'mrs' && !(location.params.reviewer === 'self' && location.params.state === 'opened')) || route === 'mr'} />
            </List>
            <Divider sx={{ my: 1.5 }} />
            <List disablePadding>
              <ClientNavItem icon={<SettingsOutlinedIcon fontSize="small" />} label="接続設定" onClick={() => navigate('settings')} selected={route === 'settings'} />
              <ClientNavItem ariaLabel="UI catalog コンポーネント一覧" icon={<SettingsOutlinedIcon fontSize="small" />} label="UI catalog" onClick={() => navigate('catalog')} selected={route === 'catalog'} />
            </List>
          </Box>
          <Stack direction="row" sx={{ alignItems: 'center', borderTop: 1, borderColor: 'divider', justifyContent: 'space-between', pt: 1 }}>
            <Typography color="text.secondary" variant="caption">{session ? `@${session.user.username}` : '接続なし'}</Typography>
            <Tooltip title={mode === 'dark' ? 'ライトモード' : 'ダークモード'}><IconButton aria-label={mode === 'dark' ? 'ライトモードに切り替え' : 'ダークモードに切り替え'} onClick={onModeChange} size="small">{mode === 'dark' ? <LightModeOutlinedIcon fontSize="small" /> : <DarkModeOutlinedIcon fontSize="small" />}</IconButton></Tooltip>
          </Stack>
        </Stack>
      </Drawer>
      <Box sx={{ display: 'flex', flex: 1, flexDirection: 'column', minWidth: 0 }}>
        <Box component="header" sx={{ alignItems: 'center', borderBottom: 1, borderColor: 'divider', display: 'flex', height: 52, justifyContent: 'space-between', px: { md: 3, xs: 2 } }}>
          <Typography sx={{ fontWeight: 700 }} variant="body2">{pageTitle}</Typography>
          <Typography color="text.secondary" variant="caption">{session ? session.instanceUrl : 'GitLab接続を設定してください'}</Typography>
        </Box>
        <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', px: { md: 3, xs: 2 }, py: { md: 2.5, xs: 2 } }}>
          {route === 'home' ? <ClientHome onPageChange={(page) => { if (page === 'merge-requests') navigate('mrs'); else navigate('projects') }} /> : null}
          {route === 'projects' ? <ProjectView key={session ? `${session.instanceUrl}:${session.user.id}` : 'anonymous'} onOpenProject={openProject} onOpenProjectId={openProjectId} /> : null}
          {route === 'mrs' ? <MergeRequestList key={`${session?.instanceUrl ?? 'anonymous'}:${session?.user.id ?? 'anonymous'}:${location.raw}`} initialParams={location.params} onOpenMergeRequest={openMergeRequest} onSearchStateChange={updateMergeRequestLocation} projectId={location.params.projectId} projectName={location.params.projectName} /> : null}
          {route === 'mr' ? <MergeRequestRoute initialMergeRequest={mergeRequest} key={location.raw} onBack={() => { window.location.hash = returnHash.replace(/^#/u, ''); setLocation(readClientLocation()) }} onOpenProject={() => navigate('mrs', { projectId: location.params.projectId ?? mergeRequest?.projectId ?? '' })} routeParams={location.params} /> : null}
          {route === 'settings' ? <SettingsView /> : null}
          {route === 'catalog' ? <Suspense fallback={<LoadingPanel />}><UiCatalogPage /></Suspense> : null}
        </Box>
        <Box aria-label="接続ステータス" component="footer" sx={{ alignItems: 'center', borderTop: 1, borderColor: 'divider', display: 'flex', height: 24, minHeight: 24, px: 1.5 }}><Typography color="text.secondary" noWrap variant="caption">{session ? `接続済み · ${session.instanceUrl}` : '未接続 · データは表示していません'}</Typography></Box>
      </Box>
    </Box>
  )
}

function ClientHome({ onPageChange }: { onPageChange: (page: 'projects' | 'merge-requests') => void }) {
  const { session } = useConnection()
  const modules = [
    { key: 'projects' as const, title: 'プロジェクト', description: '参加中または閲覧可能なプロジェクトを探します。' },
    { key: 'merge-requests' as const, title: 'MR検索', description: 'タイトル・説明・状態からレビュー対象を探します。' },
  ]
  return <Stack spacing={2.5} sx={{ maxWidth: 1120, mx: 'auto' }}>
    <Stack spacing={1}>
      <Typography color="primary.main" sx={{ fontWeight: 800 }} variant="overline">GitLab workspace</Typography>
      <Typography component="h1" variant="h1">自分の GitLab 作業を、軽く始める</Typography>
      <Typography color="text.secondary" sx={{ maxWidth: 690 }} variant="body1">GitLab.comまたはSelf-Managedへ接続して、プロジェクトとMRの確認を始めます。取得データは接続先とユーザーごとにキャッシュされます。</Typography>
    </Stack>
    <HealthPanel />
    <ConnectionView />
    <Stack spacing={1.5}>
      <Stack direction="row" sx={{ alignItems: 'end', justifyContent: 'space-between' }}><Box><Typography component="h2" variant="h2">レビューを始める</Typography><Typography color="text.secondary" variant="body2">接続後に実データを取得できます。</Typography></Box><StatusPill label={session ? '接続済み' : '未接続'} tone={session ? 'success' : 'default'} /></Stack>
      <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { md: 'repeat(2, 1fr)', xs: '1fr' } }}>
        {modules.map(({ description, key, title }) => <Card key={key}><CardActionArea onClick={() => onPageChange(key)}><CardContent><Stack spacing={0.5}><Typography sx={{ fontWeight: 700 }} variant="h3">{title}</Typography><Typography color="text.secondary" variant="body2">{description}</Typography></Stack></CardContent></CardActionArea></Card>)}
      </Box>
    </Stack>
  </Stack>
}

function SettingsView() {
  const { session } = useConnection()
  return <Stack spacing={2} sx={{ maxWidth: 860, mx: 'auto' }}><Box><Typography color="primary.main" variant="overline">Settings</Typography><Typography component="h1" variant="h1">接続設定</Typography><Typography color="text.secondary" variant="body2">GitLab.comまたはSelf-Managedの接続先を管理します。</Typography></Box><ConnectionView /><CacheSettings sessionId={session?.id ?? null} /></Stack>
}

function CacheSettings({ sessionId }: { sessionId: string | null }) {
  const [status, setStatus] = useState<string | null>(null)
  const [discarding, setDiscarding] = useState(false)
  const clear = async () => {
    if (!sessionId) return
    try { await clearGitLabCache(sessionId); setStatus('アカウントのキャッシュを削除しました。') } catch (error) { setStatus(error instanceof Error ? error.message : 'キャッシュを削除できませんでした。') }
  }
  const discardInputs = async () => {
    if (!globalThis.confirm('アプリ内の未送信コメントをすべて破棄しますか？')) return
    setDiscarding(true)
    try {
      if (sessionId) {
        const flushed = await flushComposerBuffers()
        if (!flushed) {
          setStatus('未送信コメントを保存できないため、入力を保持しています。')
          return
        }
        await clearLocalDrafts(sessionId)
      }
      clearComposerBufferStore()
      setStatus('未送信コメントを破棄しました。')
    } catch {
      setStatus('未送信コメントを破棄できませんでした。入力を保持しています。')
    } finally {
      setDiscarding(false)
    }
  }
  return <Paper component="section" sx={{ p: 2 }} variant="outlined"><Dialog aria-labelledby="discard-inputs-title" open={discarding}><DialogTitle id="discard-inputs-title">未送信コメントを破棄中</DialogTitle><DialogContent><Typography variant="body2">保存待ちと削除が完了するまでお待ちください。</Typography></DialogContent></Dialog><Stack spacing={1}><Typography sx={{ fontWeight: 700 }} variant="body2">保存データ</Typography><Typography color="text.secondary" variant="body2">取得データはRust側のアカウント別キャッシュで管理されます。未送信コメントはこの端末のアプリ保存領域に保持し、GitLabの下書きとは別に管理します。</Typography><Stack direction="row" spacing={1}><Button disabled={!sessionId} onClick={() => void clear()} size="small" variant="outlined">キャッシュを削除</Button><Button disabled={discarding} onClick={() => void discardInputs()} size="small" variant="outlined">未送信コメントをすべて破棄</Button></Stack>{status ? <Typography color="text.secondary" variant="caption">{status}</Typography> : null}</Stack></Paper>
}

function MergeRequestRoute({ initialMergeRequest, onBack, onOpenProject, routeParams }: { initialMergeRequest: MergeRequest | null; onBack: () => void; onOpenProject: () => void; routeParams: Record<string, string> }) {
  const { session } = useConnection()
  const query = useMemo(() => routeParams.projectId && routeParams.iid ? ({ iid: routeParams.iid, kind: 'mr' as const, projectId: routeParams.projectId }) : null, [routeParams.iid, routeParams.projectId])
  const lookup = useGitLabQuery(session?.id ?? null, query)
  const accessDenied = lookup.error?.code === 'AUTH_REQUIRED' || lookup.error?.code === 'FORBIDDEN' || lookup.error?.code === 'NOT_FOUND'
  const initialMatchesRoute = Boolean(initialMergeRequest && routeParams.projectId === initialMergeRequest.projectId && routeParams.iid === initialMergeRequest.iid)
  const mergeRequest = accessDenied ? null : lookup.data ?? (initialMatchesRoute ? initialMergeRequest : null)
  if (!mergeRequest) return lookup.loading ? <LoadingPanel /> : <Paper sx={{ p: 3 }} variant="outlined"><Typography variant="body2">このMRを復元できませんでした。検索から開き直してください。</Typography></Paper>
  return <MergeRequestDetail initialMergeRequest={mergeRequest} key={`${mergeRequest.projectId}:${mergeRequest.iid}`} onBack={onBack} onOpenProject={onOpenProject} />
}

function ClientNavItem({ ariaLabel, icon, label, onClick, selected }: { ariaLabel?: string; icon: React.ReactNode; label: string; onClick: () => void; selected: boolean }) {
  return <ListItemButton aria-current={selected ? 'page' : undefined} aria-label={ariaLabel} onClick={onClick} selected={selected} sx={{ minHeight: 36, px: 1 }}><ListItemIcon sx={{ minWidth: 32 }}>{icon}</ListItemIcon><ListItemText primary={label} slotProps={{ primary: { sx: { fontSize: 13, fontWeight: 700 } } }} /></ListItemButton>
}

function LoadingPanel() { return <Paper aria-live="polite" role="status" sx={{ p: 3, textAlign: 'center' }} variant="outlined"><Typography color="text.secondary" variant="body2">画面を読み込み中…</Typography></Paper> }

function readClientLocation(): { raw: string; route: ClientRoute; params: Record<string, string> } {
  const raw = window.location.hash.replace(/^#/u, '')
  if (!raw.startsWith('client')) return { params: {}, raw, route: 'home' }
  const [path, search] = raw.split('?')
  const routeValue = path.split('/')[1] as ClientRoute | undefined
  const route: ClientRoute = routeValue === 'projects' || routeValue === 'mrs' || routeValue === 'settings' || routeValue === 'catalog' || routeValue === 'mr' ? routeValue : 'home'
  return { params: Object.fromEntries(new URLSearchParams(search ?? '').entries()), raw, route }
}
