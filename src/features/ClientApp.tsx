import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import MenuOpenRoundedIcon from '@mui/icons-material/MenuOpenRounded'
import MenuRoundedIcon from '@mui/icons-material/MenuRounded'
import PersonOutlineRoundedIcon from '@mui/icons-material/PersonOutlineRounded'
import RateReviewOutlinedIcon from '@mui/icons-material/RateReviewOutlined'
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined'
import LinkRoundedIcon from '@mui/icons-material/LinkRounded'
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded'
import TaskAltRoundedIcon from '@mui/icons-material/TaskAltRounded'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Divider from '@mui/material/Divider'
import Dialog from '@mui/material/Dialog'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import IconButton from '@mui/material/IconButton'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import useMediaQuery from '@mui/material/useMediaQuery'
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import { Kbd, PaneEmpty } from '../components/Pane'
import { SettingsSection } from '../components/SettingsSection'
import { UpdatePanel } from '../components/UpdatePanel'
import { clearLocalDrafts } from '../lib/localDrafts'
import { getRuntimeInfo, isTauri } from '../lib/runtime'
import type { MergeRequest, Project } from '../types/gitlab'
import { ConnectionProvider, useConnection } from './connections/ConnectionProvider'
import { ConnectionView } from './connections/ConnectionView'
import { clearComposerBuffers, MergeRequestDetail, type ReviewTab } from './mergeRequests/MergeRequestDetail'
import { clearGitLabCache } from '../lib/gitlab'
import { clearComposerBufferStore, flushComposerBuffers } from './mergeRequests/useComposerBuffer'
import { WindowCloseProtection } from '../components/WindowCloseProtection'
import { MergeRequestList } from './mergeRequests/MergeRequestList'
import { ProjectView } from './projects/ProjectView'
import { WorkspaceSettings } from './connections/WorkspaceSettings'
import { TodoView } from './mergeRequests/TodoView'
import { MergeRequestShortcuts } from './mergeRequests/MergeRequestShortcuts'
import { MergeRequestTabs } from './mergeRequests/MergeRequestTabs'
import { OpenMergeRequestDialog } from './mergeRequests/OpenMergeRequestDialog'
import { openWorkspaceTab, usePersonalWorkspace, type MrRef } from './shared/personalWorkspace'
import { WorkspaceMonitor } from './shared/WorkspaceMonitor'
import { QueryRefreshPolicy } from './shared/QueryRefreshPolicy'
import { AutoUpdateSafetyProvider, useAutoUpdateAllowed } from './shared/AutoUpdateSafety'
import { GitLabUserAvatar } from './shared/GitLabUserAvatar'
import { clearGitLabMutationStates } from './shared/useGitLabMutation'
import { useGitLabQuery } from './shared/useGitLabQuery'

const LIST_HIDDEN_KEY = 'gitlab-desktop:list-hidden'
const SIDEBAR_COLLAPSED_BROWSING_KEY = 'gitlab-desktop:sidebar-collapsed'
const SIDEBAR_COLLAPSED_REVIEWING_KEY = 'gitlab-desktop:sidebar-collapsed-reviewing'

function readLayoutPreference(key: string, fallback: boolean): boolean {
  try {
    const value = globalThis.localStorage?.getItem(key)
    return value === null || value === undefined ? fallback : value === 'true'
  } catch {
    return fallback
  }
}

function writeLayoutPreference(key: string, value: boolean): void {
  try {
    globalThis.localStorage?.setItem(key, String(value))
  } catch {
    // The layout still changes until the window is reopened.
  }
}

type ClientRoute = 'projects' | 'mrs' | 'settings' | 'todos' | 'pinned' | 'recent'

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
  const { session } = useConnection()
  const workspace = usePersonalWorkspace(session)
  const autoInstallAllowed = useAutoUpdateAllowed() && status !== 'checking'
  // The updater stays mounted across authentication resets so its install guard
  // and result remain active for the lifetime of the app.
  return <Box sx={{ bgcolor: 'background.default', display: 'flex', flexDirection: 'column', height: '100vh' }}>
    <WindowCloseProtection />
    <QueryRefreshPolicy value={workspace.settings.autoRefresh && autoInstallAllowed}>
      <WorkspaceMonitor key={sessionKey} />
      <ClientWorkspace mode={mode} onModeChange={onModeChange} autoInstallAllowed={autoInstallAllowed} sessionKey={sessionKey} status={status} />
    </QueryRefreshPolicy>
  </Box>
}

function ClientWorkspace({ mode, onModeChange, autoInstallAllowed, sessionKey, status }: { mode: 'light' | 'dark'; onModeChange: () => void; autoInstallAllowed: boolean; sessionKey: string; status: string }) {
  const { session } = useConnection()
  const workspace = usePersonalWorkspace(session)
  const locationHash = useSyncExternalStore(subscribeToClientLocation, getClientLocationHash, getClientLocationHash)
  const location = readClientLocation(Boolean(session), locationHash)
  const [openedMergeRequest, setOpenedMergeRequest] = useState<{ sessionKey: string; mergeRequest: MergeRequest } | null>(null)
  const [openUrlDialog, setOpenUrlDialog] = useState(false)
  const [listHidden, setListHidden] = useState(() => readLayoutPreference(LIST_HIDDEN_KEY, false))
  // Wide windows show the list and the detail side by side; narrow windows show one at a time.
  const isWide = useMediaQuery('(min-width:1100px)')
  const isNarrowNav = useMediaQuery('(max-width:1000px)')
  // Reading an MR gets the width: the navigation shrinks to icons while an MR is open
  // unless the reader expanded it there, and the choice is kept separately for each case.
  const [sidebarCollapsedBrowsing, setSidebarCollapsedBrowsing] = useState(() => readLayoutPreference(SIDEBAR_COLLAPSED_BROWSING_KEY, false))
  const [sidebarCollapsedReviewing, setSidebarCollapsedReviewing] = useState(() => readLayoutPreference(SIDEBAR_COLLAPSED_REVIEWING_KEY, true))
  const [narrowSidebarExpanded, setNarrowSidebarExpanded] = useState(false)
  const { route, params } = location
  const selected = parseSelection(params.mr)
  const reviewing = Boolean(selected) && route !== 'settings'
  const sidebarIsCollapsed = isNarrowNav ? !narrowSidebarExpanded : reviewing ? sidebarCollapsedReviewing : sidebarCollapsedBrowsing
  const toggleSidebar = () => {
    if (isNarrowNav) {
      setNarrowSidebarExpanded((current) => !current)
      return
    }
    const next = !sidebarIsCollapsed
    if (reviewing) setSidebarCollapsedReviewing(next)
    else setSidebarCollapsedBrowsing(next)
    writeLayoutPreference(reviewing ? SIDEBAR_COLLAPSED_REVIEWING_KEY : SIDEBAR_COLLAPSED_BROWSING_KEY, next)
  }
  const toggleList = useCallback(() => setListHidden((current) => !current), [setListHidden])
  useEffect(() => writeLayoutPreference(LIST_HIDDEN_KEY, listHidden), [listHidden])
  const listParams = useMemo(() => withoutSelection(params), [params])
  const listKey = JSON.stringify(listParams)

  const navigate = useCallback((nextRoute: ClientRoute, nextParams?: Record<string, string>) => {
    window.location.hash = locationToHash(nextRoute, nextParams ?? {}).replace(/^#/u, '')
    globalThis.dispatchEvent(new Event('gitlab-client-location-change'))
  }, [])

  const select = useCallback((ref: MrRef | null) => {
    const current = readClientLocation(Boolean(session))
    const targetRoute = current.route === 'settings' ? 'recent' : current.route
    const base: Record<string, string> = targetRoute === current.route ? withoutSelection(current.params) : {}
    if (ref && current.params.mr === `${ref.projectId}-${ref.iid}` && current.params.tab) base.tab = current.params.tab
    navigate(targetRoute, ref ? { ...base, mr: `${ref.projectId}-${ref.iid}` } : base)
  }, [navigate, session])

  useEffect(() => () => {
    clearGitLabMutationStates(session?.id)
  }, [session?.id])

  useEffect(() => {
    if (!session && status === 'checking') return
    if (window.location.hash !== locationHash) return
    const canonicalHash = locationToHash(location.route, location.params)
    if (window.location.hash !== canonicalHash) {
      window.history.replaceState(window.history.state, '', canonicalHash)
      globalThis.dispatchEvent(new Event('gitlab-client-location-change'))
    }
  }, [location.params, location.route, location.raw, locationHash, session, status])

  useEffect(() => {
    // The mouse's back/forward side buttons move through the screens visited in
    // this window. If the WebView navigates by itself anyway, its popstate
    // arrives first and the history is not moved twice.
    let pending: ReturnType<typeof globalThis.setTimeout> | undefined
    const cancelPending = () => { globalThis.clearTimeout(pending); pending = undefined }
    const handleSideButton = (event: MouseEvent) => {
      if (event.button !== 3 && event.button !== 4) return
      event.preventDefault()
      cancelPending()
      const back = event.button === 3
      pending = globalThis.setTimeout(() => {
        pending = undefined
        if (back) window.history.back()
        else window.history.forward()
      }, 50)
    }
    window.addEventListener('mouseup', handleSideButton)
    window.addEventListener('popstate', cancelPending)
    return () => {
      cancelPending()
      window.removeEventListener('mouseup', handleSideButton)
      window.removeEventListener('popstate', cancelPending)
    }
  }, [])

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const modifier = event.ctrlKey || event.metaKey
      if (modifier && event.key.toLowerCase() === 'o') { event.preventDefault(); setOpenUrlDialog(true); return }
      if (modifier && event.key === '\\' && isWide && selected) { event.preventDefault(); toggleList(); return }
      if (modifier && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        if (route !== 'projects' && route !== 'mrs') {
          navigate('mrs')
          globalThis.setTimeout(() => globalThis.dispatchEvent(new Event('gitlab-focus-project-search')), 0)
        } else {
          globalThis.dispatchEvent(new Event('gitlab-focus-project-search'))
        }
        return
      }
      if (event.defaultPrevented || modifier || event.altKey || isEditableTarget(event.target) || document.querySelector('[role="dialog"]')) return
      if (event.key === 'j' || event.key === 'k') {
        const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-list-pane] [data-list-row="true"]'))
        if (rows.length === 0) return
        event.preventDefault()
        const current = rows.findIndex((row) => row.dataset.selected === 'true')
        const next = current < 0 ? 0 : Math.min(rows.length - 1, Math.max(0, current + (event.key === 'j' ? 1 : -1)))
        if (next !== current) { rows[next].click(); rows[next].scrollIntoView?.({ block: 'nearest' }) }
        return
      }
      if (event.key === '/') {
        event.preventDefault()
        globalThis.dispatchEvent(new Event('gitlab-focus-project-search'))
        return
      }
      if (event.key === 'Escape' && selected && !isWide) select(null)
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [isWide, navigate, route, select, selected, toggleList])

  const openProject = (nextProject: Project) => {
    navigate('mrs', { projectId: nextProject.id, projectName: nextProject.name })
  }

  const openProjectId = (nextProjectId: string) => {
    navigate('mrs', { projectId: nextProjectId })
  }

  const updateMergeRequestLocation = (nextParams: Record<string, string>) => {
    const current = readClientLocation(Boolean(session))
    const merged: Record<string, string> = { ...nextParams }
    if (current.params.projectName && nextParams.projectId === current.params.projectId) merged.projectName = current.params.projectName
    if (current.params.mr) merged.mr = current.params.mr
    if (current.params.tab) merged.tab = current.params.tab
    const hash = locationToHash('mrs', merged)
    window.history.replaceState(window.history.state, '', hash)
    globalThis.dispatchEvent(new Event('gitlab-client-location-change'))
  }

  const openMergeRequest = (nextMergeRequest: MergeRequest) => {
    setOpenedMergeRequest({ sessionKey, mergeRequest: nextMergeRequest })
    select({ iid: nextMergeRequest.iid, projectId: nextMergeRequest.projectId })
  }

  const openMergeRequestRef = (ref: MrRef | null) => {
    setOpenedMergeRequest(null)
    select(ref)
  }

  // The shown MR always has a sidebar tab, also when reached by Back or a link,
  // or when it is unpinned while shown.
  const selectedProjectId = selected?.projectId
  const selectedIid = selected?.iid
  const selectedPinned = workspace.pinned.some((item) => item.projectId === selectedProjectId && item.iid === selectedIid)
  const instanceUrl = session?.instanceUrl
  const userId = session?.user.id
  useEffect(() => {
    if (selectedProjectId && selectedIid && !selectedPinned && instanceUrl && userId) openWorkspaceTab({ instanceUrl, userId }, { iid: selectedIid, projectId: selectedProjectId })
  }, [instanceUrl, selectedIid, selectedPinned, selectedProjectId, userId])

  const personal = personalNavigationFor(params, session?.user.id)
  const navSelected = {
    waiting: route === 'mrs' && personal === 'waiting',
    assigned: route === 'mrs' && personal === 'assigned',
    created: route === 'mrs' && personal === 'created',
    projects: route === 'projects' || (route === 'mrs' && personal === null && Boolean(params.projectName)),
    search: route === 'mrs' && personal === null && !params.projectName,
  }
  const mergeRequest = openedMergeRequest?.sessionKey === sessionKey ? openedMergeRequest.mergeRequest : null
  const waitingForSessionRestore = !session && status === 'checking' && !window.location.hash
  const showList = route !== 'settings' && (isWide ? !listHidden || !selected : !selected)
  const showDetail = route !== 'settings' && (isWide || Boolean(selected))

  // Places only; one-off actions such as opening a URL sit beside the search box.
  // `title` is the full name (tooltip, accessible name and list heading); `label`
  // is the short text under its section heading.
  const navSections: Array<{ heading?: string; items: Array<{ key: string; label: string; title: string; icon: React.ReactNode; selected: boolean; onClick: () => void }> }> = [
    { items: [
      { icon: <FolderOutlinedIcon />, key: 'projects', label: 'プロジェクト', onClick: () => navigate('projects'), selected: navSelected.projects, title: 'プロジェクト' },
    ] },
    { heading: '自分のMR', items: [
      { icon: <TaskAltRoundedIcon />, key: 'todos', label: 'To-Do', onClick: () => navigate('todos'), selected: route === 'todos', title: 'To-Do' },
      { icon: <FactCheckOutlinedIcon />, key: 'waiting', label: 'レビュー依頼', onClick: () => navigate('mrs', { reviewer: 'self', state: 'opened' }), selected: navSelected.waiting, title: 'レビュー依頼' },
      { icon: <PersonOutlineRoundedIcon />, key: 'assigned', label: '担当', onClick: () => navigate('mrs', { assignee: 'self', state: 'opened' }), selected: navSelected.assigned, title: '担当しているMR' },
      { icon: <EditOutlinedIcon />, key: 'created', label: '作成', onClick: () => session ? navigate('mrs', { authorId: session.user.id, state: 'opened' }) : navigate('settings'), selected: navSelected.created, title: '作成したMR' },
    ] },
    { heading: 'よく見るMR', items: [
      { icon: <HistoryRoundedIcon />, key: 'recent', label: '最近開いた', onClick: () => navigate('recent'), selected: route === 'recent', title: '最近開いたMR' },
    ] },
  ]
  const openSearch = () => {
    navigate('mrs')
    globalThis.setTimeout(() => globalThis.dispatchEvent(new Event('gitlab-focus-project-search')), 0)
  }

  return (
    <Box sx={{ display: 'flex', flex: 1, flexDirection: 'column', minHeight: 0 }}>
      <Box sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <Box component="aside" sx={{ bgcolor: 'surface.nav', borderRight: 1, borderColor: 'divider', display: 'flex', flexDirection: 'column', flexShrink: 0, overflowX: 'hidden', overflowY: 'auto', px: 1, py: 1, transition: 'width 120ms', width: sidebarIsCollapsed ? 52 : 208, '@media (prefers-reduced-motion: reduce)': { transition: 'none' } }}>
          <Stack direction="row" sx={{ alignItems: 'center', justifyContent: sidebarIsCollapsed ? 'center' : 'space-between', minHeight: 36, mb: 1, pl: sidebarIsCollapsed ? 0 : 1 }}>
            {sidebarIsCollapsed ? null : <Typography noWrap sx={{ fontWeight: 600, letterSpacing: '-0.01em' }} variant="body2">GitLab Desktop</Typography>}
            <Tooltip placement="right" title={sidebarIsCollapsed ? 'ナビゲーションを展開' : 'ナビゲーションを折りたたむ'}>
              <IconButton
                aria-label={sidebarIsCollapsed ? 'ナビゲーションを展開' : 'ナビゲーションを折りたたむ'}
                onClick={toggleSidebar}
              >
                {sidebarIsCollapsed ? <MenuRoundedIcon /> : <MenuOpenRoundedIcon />}
              </IconButton>
            </Tooltip>
          </Stack>
          <NavSearch collapsed={sidebarIsCollapsed} onOpenUrl={() => setOpenUrlDialog(true)} onSearch={openSearch} selected={navSelected.search} />
          <Box component="nav" aria-label="GitLab client navigation" sx={{ display: 'flex', flex: 1, flexDirection: 'column' }}>
            {navSections.map((section) => (
              <List aria-label={section.heading} disablePadding key={section.heading ?? 'top'} subheader={section.heading ? sidebarIsCollapsed ? <Divider component="li" sx={{ my: 1 }} /> : <Typography color="text.secondary" component="li" sx={{ display: 'block', fontSize: 11, fontWeight: 600, pb: 0.25, pl: 1, pt: 1.5 }}>{section.heading}</Typography> : undefined}>
                {section.items.map((item) => <ClientNavItem collapsed={sidebarIsCollapsed} icon={item.icon} key={item.key} label={item.label} onClick={item.onClick} selected={item.selected} title={item.title} />)}
              </List>
            ))}
            <MergeRequestTabs collapsed={sidebarIsCollapsed} onOpen={openMergeRequestRef} selected={selected} />
            <List disablePadding sx={{ mt: 'auto', pt: 1 }}>
              <ClientNavItem collapsed={sidebarIsCollapsed} icon={<SettingsOutlinedIcon />} label="接続設定" onClick={() => navigate('settings')} selected={route === 'settings'} title="接続設定" />
            </List>
          </Box>
          <Stack direction={sidebarIsCollapsed ? 'column' : 'row'} spacing={0.5} sx={{ alignItems: 'center', borderTop: 1, borderColor: 'divider', mt: 1, pt: 1 }}>
            <Tooltip placement="right" title={session ? `${session.user.name} @${session.user.username}` : '未接続'}>
              <Box component="span" sx={{ display: 'flex', flexShrink: 0 }}>{session ? <GitLabUserAvatar sessionId={session.id} size={24} user={session.user} /> : <Box sx={{ bgcolor: 'action.selected', borderRadius: '50%', height: 24, width: 24 }} />}</Box>
            </Tooltip>
            {sidebarIsCollapsed ? null : <Typography color="text.secondary" noWrap sx={{ flex: 1, minWidth: 0 }} variant="caption">{session ? `@${session.user.username}` : '未接続'}</Typography>}
            <Tooltip placement="right" title={mode === 'dark' ? 'ライトモード' : 'ダークモード'}><IconButton aria-label={mode === 'dark' ? 'ライトモードに切り替え' : 'ダークモードに切り替え'} onClick={onModeChange}>{mode === 'dark' ? <LightModeOutlinedIcon /> : <DarkModeOutlinedIcon />}</IconButton></Tooltip>
          </Stack>
        </Box>

        <Box sx={{ display: 'flex', flex: 1, flexDirection: 'column', minWidth: 0 }}>
          <UpdatePanel autoInstallAllowed={autoInstallAllowed} compact notificationOnly />
          <OpenMergeRequestDialog open={openUrlDialog} onClose={() => setOpenUrlDialog(false)} onOpen={openMergeRequestRef} />
          <Box key={sessionKey} sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
            {waitingForSessionRestore ? <>
              {/* The same panes as the restored screen, so nothing moves when it arrives. */}
              <Box aria-label="一覧" component="section" sx={{ bgcolor: 'surface.list', borderRight: isWide ? 1 : 0, borderColor: 'divider', flex: isWide ? '0 0 auto' : 1, minWidth: 0, width: isWide ? { lg: 400, xs: 360 } : 'auto' }}><RestoreSessionPanel /></Box>
              {isWide ? <Box component="main" sx={{ flex: 1, minWidth: 0 }} /> : null}
            </> : null}
            {!waitingForSessionRestore && route === 'settings' ? (
              <Box component="main" sx={{ flex: 1, overflow: 'auto' }}>
                <Box sx={{ maxWidth: 880, mx: 'auto', px: { md: 5, xs: 2.5 }, py: 3.5 }}><SettingsView /></Box>
              </Box>
            ) : null}
            {!waitingForSessionRestore && route !== 'settings' ? <>
              <Box aria-label="一覧" component="section" data-list-pane="true" sx={{ bgcolor: 'surface.list', borderRight: isWide ? 1 : 0, borderColor: 'divider', display: showList ? 'flex' : 'none', flex: isWide ? '0 0 auto' : 1, flexDirection: 'column', minHeight: 0, minWidth: 0, width: isWide ? { lg: 400, xs: 360 } : 'auto' }}>
                {route === 'projects' ? <ProjectView onOpenProject={openProject} onOpenProjectId={openProjectId} /> : null}
                {route === 'mrs' ? <MergeRequestList key={`${session?.instanceUrl ?? 'anonymous'}:${session?.user.id ?? 'anonymous'}:${listKey}`} initialParams={listParams} onOpenMergeRequest={openMergeRequest} onSearchStateChange={updateMergeRequestLocation} projectId={params.projectId} projectName={params.projectName} selected={selected} /> : null}
                {route === 'todos' ? <TodoView onOpen={openMergeRequestRef} selected={selected} /> : null}
                {route === 'pinned' || route === 'recent' ? <MergeRequestShortcuts kind={route} onOpen={openMergeRequestRef} selected={selected} /> : null}
              </Box>
              <Box component="main" sx={{ display: showDetail ? 'block' : 'none', flex: 1, minWidth: 0, overflow: 'auto' }}>
                {selected ? <MergeRequestRoute
                  initialMergeRequest={mergeRequest}
                  key={`${selected.projectId}:${selected.iid}`}
                  listHidden={isWide ? listHidden : undefined}
                  onBack={isWide ? undefined : () => select(null)}
                  onOpenProject={() => navigate('mrs', { projectId: selected.projectId })}
                  onTabChange={(tab) => {
                    // Each tab is a history entry, so Back returns to the previous tab.
                    const next = { ...params }
                    if (tab === 'discussion') delete next.tab
                    else next.tab = tab
                    navigate(route, next)
                  }}
                  onToggleList={isWide ? toggleList : undefined}
                  selected={selected}
                  tab={parseTab(params.tab)}
                /> : <DetailPlaceholder hasSession={Boolean(session)} />}
              </Box>
            </> : null}
          </Box>
        </Box>
      </Box>
      <Box aria-label="接続ステータス" component="footer" sx={{ alignItems: 'center', bgcolor: 'surface.nav', borderTop: 1, borderColor: 'divider', display: 'flex', gap: 0.75, height: 24, minHeight: 24, px: 1.5 }}>
        <Box sx={{ bgcolor: session ? 'success.main' : 'text.disabled', borderRadius: '50%', flexShrink: 0, height: 6, width: 6 }} />
        <Typography color="text.secondary" noWrap sx={{ fontSize: 11 }} variant="caption">
          {session ? `接続済み · ${session.instanceUrl} · @${session.user.username}` : '未接続 · データは表示していません'}{!isTauri() ? ' · ブラウザプレビュー' : ''}
        </Typography>
        <AppVersionLabel />
      </Box>
    </Box>
  )
}

/** The version of the running desktop app; nothing in the browser preview, which has no native side. */
function AppVersionLabel() {
  const [version, setVersion] = useState<string | null>(null)
  useEffect(() => {
    if (!isTauri()) return
    let active = true
    getRuntimeInfo().then((info) => { if (active) setVersion(info.appVersion) }).catch(() => undefined)
    return () => { active = false }
  }, [])
  if (!version) return null
  return <Typography aria-label={`アプリのバージョン ${version}`} color="text.secondary" noWrap sx={{ flexShrink: 0, fontSize: 11, ml: 'auto' }} variant="caption">v{version}</Typography>
}

function DetailPlaceholder({ hasSession }: { hasSession: boolean }) {
  return <PaneEmpty description={hasSession ? '一覧からMRを選ぶと、ここに議論・変更・概要を表示します。' : '接続設定でGitLabに接続すると、MRを表示できます。'} icon={<RateReviewOutlinedIcon fontSize="inherit" />} title={hasSession ? 'MRを選択してください' : 'GitLabに接続していません'}>
    {hasSession ? <Stack spacing={0.75} sx={{ mt: 2 }}>
      <ShortcutHint keys={['J', 'K']} label="一覧の前後へ移動" />
      <ShortcutHint keys={['/']} label="検索欄へ移動" />
      <ShortcutHint keys={['Ctrl', 'O']} label="MRのURLから開く" />
    </Stack> : null}
  </PaneEmpty>
}

function ShortcutHint({ keys, label }: { keys: string[]; label: string }) {
  return <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between', minWidth: 220 }}><Typography color="text.secondary" variant="caption">{label}</Typography><Stack direction="row" spacing={0.5}>{keys.map((key) => <Kbd key={key}>{key}</Kbd>)}</Stack></Stack>
}

function SettingsView() {
  const { session } = useConnection()
  return <Box>
    <Box sx={{ pb: 2.5 }}>
      <Typography component="h1" variant="h1">接続設定</Typography>
      <Typography color="text.secondary" sx={{ mt: 0.5 }} variant="body2">GitLabへの接続と、この端末に保存するデータを管理します。</Typography>
    </Box>
    <SettingsSection description="接続先とアクセス方法" id="settings-connection" title="GitLab接続"><ConnectionView /></SettingsSection>
    <SettingsSection description="自動更新とデスクトップ通知" id="settings-workspace" title="更新と通知"><WorkspaceSettings /></SettingsSection>
    <SettingsSection description="この端末に保存するMR情報と未送信コメント" id="settings-data" title="保存データ"><CacheSettings sessionId={session?.id ?? null} /></SettingsSection>
  </Box>
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
  return <Stack spacing={1.25}>
    <Dialog aria-labelledby="discard-inputs-title" open={discarding}><DialogTitle id="discard-inputs-title">未送信コメントを破棄中</DialogTitle><DialogContent><Typography variant="body2">保存待ちと削除が完了するまでお待ちください。</Typography></DialogContent></Dialog>
    <Typography color="text.secondary" variant="body2">未送信コメントはGitLabのレビュー下書きとは別に管理します。キャッシュを削除しても未送信コメントと送信結果の確認記録は残ります。</Typography>
    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
      <Button disabled={!sessionId} onClick={() => void clear()} variant="outlined">キャッシュを削除</Button>
      <Button color="error" disabled={discarding} onClick={() => void discardInputs()} variant="outlined">未送信コメントをすべて破棄</Button>
    </Stack>
    {status ? <Typography color="text.secondary" role="status" variant="caption">{status}</Typography> : null}
  </Stack>
}

function MergeRequestRoute({ initialMergeRequest, listHidden, onBack, onOpenProject, onTabChange, onToggleList, selected, tab }: { initialMergeRequest: MergeRequest | null; listHidden?: boolean; onBack?: () => void; onOpenProject: () => void; onTabChange: (tab: ReviewTab) => void; onToggleList?: () => void; selected: MrRef; tab: ReviewTab }) {
  const { session } = useConnection()
  const query = useMemo(() => ({ iid: selected.iid, kind: 'mr' as const, projectId: selected.projectId }), [selected.iid, selected.projectId])
  const lookup = useGitLabQuery(session?.id ?? null, query)
  const accessDenied = lookup.error?.code === 'AUTH_REQUIRED' || lookup.error?.code === 'FORBIDDEN' || lookup.error?.code === 'NOT_FOUND'
  const initialMatchesRoute = Boolean(initialMergeRequest && selected.projectId === initialMergeRequest.projectId && selected.iid === initialMergeRequest.iid)
  const mergeRequest = accessDenied ? null : lookup.data ?? (initialMatchesRoute ? initialMergeRequest : null)
  if (!mergeRequest) {
    return lookup.loading
      ? <MergeRequestSkeleton />
      : <PaneEmpty description="検索から開き直してください。" title="このMRを復元できませんでした。">{onBack ? <Button onClick={onBack} startIcon={<ArrowBackRoundedIcon />}>一覧に戻る</Button> : null}</PaneEmpty>
  }
  return <MergeRequestDetail initialMergeRequest={mergeRequest} key={`${mergeRequest.projectId}:${mergeRequest.iid}`} listHidden={listHidden} onBack={onBack} onOpenProject={onOpenProject} onTabChange={onTabChange} onToggleList={onToggleList} tab={tab} />
}

/** Placeholder with the shape of the MR detail header, so the detail does not jump in. */
function MergeRequestSkeleton() {
  const bar = (width: number | string, height = 12) => <Box sx={{ bgcolor: 'action.hover', borderRadius: 0.5, height, width }} />
  return <Box aria-live="polite" role="status" sx={{ borderBottom: 1, borderColor: 'divider', px: { md: 3, xs: 2 }, pb: 1.5, pt: 1.25 }}>
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minHeight: 32 }}>
      <Typography color="text.secondary" variant="caption">MRを読み込み中…</Typography>
    </Stack>
    <Stack spacing={1.25} sx={{ mt: 0.75 }}>
      {bar('60%', 22)}
      {bar('45%')}
      {bar('30%')}
    </Stack>
  </Box>
}

/** The search entry at the top of the navigation, with opening by URL beside it. */
function NavSearch({ collapsed, onOpenUrl, onSearch, selected }: { collapsed: boolean; onOpenUrl: () => void; onSearch: () => void; selected: boolean }) {
  const openUrl = <Tooltip placement="right" title="MR URLから開く (Ctrl+O)"><IconButton aria-label="MR URLから開く" onClick={onOpenUrl}><LinkRoundedIcon /></IconButton></Tooltip>
  if (collapsed) {
    return <Stack sx={{ alignItems: 'center', mb: 0.5 }}>
      <ClientNavItem collapsed icon={<SearchRoundedIcon />} label="MRを検索" onClick={onSearch} selected={selected} title="MR検索" />
      {openUrl}
    </Stack>
  }
  return <Stack direction="row" spacing={0.25} sx={{ alignItems: 'center', mb: 0.5 }}>
    <ListItemButton
      aria-current={selected ? 'page' : undefined}
      aria-label="MR検索"
      onClick={onSearch}
      selected={selected}
      sx={{ border: 1, borderColor: selected ? 'primary.main' : 'divider', borderRadius: 1, color: 'text.secondary', flex: 1, gap: 0.75, minHeight: 30, minWidth: 0, px: 1, py: 0.25, '&:hover': { borderColor: 'text.secondary', color: 'text.primary' }, '&.Mui-selected': { bgcolor: 'action.selected', color: 'text.primary' } }}
    >
      <SearchRoundedIcon sx={{ fontSize: 16 }} />
      <Typography noWrap sx={{ flex: 1, fontSize: 12 }}>MRを検索</Typography>
      <Kbd>Ctrl K</Kbd>
    </ListItemButton>
    {openUrl}
  </Stack>
}

function ClientNavItem({ collapsed, icon, label, onClick, selected, title }: { collapsed: boolean; icon: React.ReactNode; label: string; onClick: () => void; selected: boolean; title: string }) {
  return <Tooltip placement="right" title={collapsed || title !== label ? title : ''}>
    <ListItemButton aria-current={selected ? 'page' : undefined} aria-label={title} onClick={onClick} selected={selected} sx={{ color: selected ? 'text.primary' : 'text.secondary', justifyContent: collapsed ? 'center' : 'initial', minHeight: 32, px: collapsed ? 0 : 1, py: 0.5, '&:hover': { color: 'text.primary' }, '&.Mui-selected': { bgcolor: 'action.selected', color: 'text.primary' }, '&.Mui-selected .MuiListItemIcon-root': { color: 'primary.main' } }}>
      <ListItemIcon sx={{ justifyContent: 'center', minWidth: collapsed ? 0 : 30, '& .MuiSvgIcon-root': { fontSize: 18 } }}>{icon}</ListItemIcon>
      {collapsed ? null : <ListItemText primary={label} slotProps={{ primary: { noWrap: true, sx: { fontSize: 13, fontWeight: selected ? 600 : 500 } } }} sx={{ m: 0 }} />}
    </ListItemButton>
  </Tooltip>
}

function RestoreSessionPanel() { return <Box aria-live="polite" role="status"><PaneEmpty title="GitLab接続を確認中…" /></Box> }

function subscribeToClientLocation(onChange: () => void) {
  window.addEventListener('hashchange', onChange)
  window.addEventListener('popstate', onChange)
  globalThis.addEventListener('gitlab-client-location-change', onChange)
  return () => {
    window.removeEventListener('hashchange', onChange)
    window.removeEventListener('popstate', onChange)
    globalThis.removeEventListener('gitlab-client-location-change', onChange)
  }
}

function getClientLocationHash() { return window.location.hash }

const defaultQueue = { reviewer: 'self', state: 'opened' }

function readClientLocation(hasSession: boolean, hash = window.location.hash): { raw: string; route: ClientRoute; params: Record<string, string> } {
  const raw = hash.replace(/^#/u, '')
  if (!raw.startsWith('client')) return hasSession
    ? { params: defaultQueue, raw, route: 'mrs' }
    : { params: {}, raw, route: 'settings' }
  const [path, search] = raw.split('?')
  const routeValue = path.split('/')[1]
  let params = Object.fromEntries(new URLSearchParams(search ?? '').entries())
  let route: ClientRoute | null = routeValue === 'projects' || routeValue === 'mrs' || routeValue === 'settings' || routeValue === 'todos' || routeValue === 'pinned' || routeValue === 'recent' ? routeValue : null
  if (routeValue === 'mr' && params.projectId && params.iid) {
    // Older links opened a full-page detail; show it beside the default queue.
    route = 'mrs'
    params = { ...defaultQueue, mr: `${params.projectId}-${params.iid}` }
  }
  if (!route) {
    route = hasSession ? 'mrs' : 'settings'
    params = hasSession ? defaultQueue : {}
  } else if (!hasSession && route !== 'settings') {
    route = 'settings'
    params = {}
  }
  return { params, raw, route }
}

function locationToHash(route: ClientRoute, params: Record<string, string>) {
  const query = Object.keys(params).length ? `?${new URLSearchParams(params).toString()}` : ''
  return `#client/${route}${query}`
}

function parseSelection(value: string | undefined): MrRef | null {
  const match = value ? /^([1-9]\d*)-([1-9]\d*)$/u.exec(value) : null
  return match ? { iid: match[2], projectId: match[1] } : null
}

function withoutSelection(params: Record<string, string>): Record<string, string> {
  if (!('mr' in params) && !('tab' in params)) return params
  const next = { ...params }
  delete next.mr
  delete next.tab
  return next
}

function parseTab(value: string | undefined): ReviewTab {
  return value === 'changes' || value === 'overview' ? value : 'discussion'
}

function personalNavigationFor(params: Record<string, string>, userId: string | undefined): 'waiting' | 'assigned' | 'created' | null {
  if (params.assignee === 'self') return 'assigned'
  if (params.reviewer === 'self') return 'waiting'
  if (userId && params.authorId === userId) return 'created'
  return null
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select, [role="combobox"], [contenteditable="true"]') !== null)
}
