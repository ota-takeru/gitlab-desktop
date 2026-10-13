import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import MenuOpenRoundedIcon from '@mui/icons-material/MenuOpenRounded'
import MenuRoundedIcon from '@mui/icons-material/MenuRounded'
import RateReviewOutlinedIcon from '@mui/icons-material/RateReviewOutlined'
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined'
import LinkRoundedIcon from '@mui/icons-material/LinkRounded'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import IconButton from '@mui/material/IconButton'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Stack from '@mui/material/Stack'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import useMediaQuery from '@mui/material/useMediaQuery'
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import { PaneEmpty } from '../components/Pane'
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
import { BranchList } from './projects/BranchList'
import { ProjectView } from './projects/ProjectView'
import { WorkspaceSettings } from './connections/WorkspaceSettings'
import { TodoView } from './mergeRequests/TodoView'
import { RecentMergeRequests } from './mergeRequests/RecentMergeRequests'
import { MergeRequestTabs } from './mergeRequests/MergeRequestTabs'
import { OpenMergeRequestDialog } from './mergeRequests/OpenMergeRequestDialog'
import { personalQueueFor } from './mergeRequests/personalQueue'
import { openWorkspaceTab, usePersonalWorkspace, type MrRef } from './shared/personalWorkspace'
import { WorkspaceMonitor } from './shared/WorkspaceMonitor'
import { QueryRefreshPolicy } from './shared/QueryRefreshPolicy'
import { AutoUpdateSafetyProvider, useAutoUpdateAllowed } from './shared/AutoUpdateSafety'
import { GitLabUserAvatar } from './shared/GitLabUserAvatar'
import { clearGitLabMutationStates } from './shared/useGitLabMutation'
import { useGitLabQuery } from './shared/useGitLabQuery'

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

type ClientRoute = 'projects' | 'mrs' | 'branches' | 'settings' | 'todos' | 'recent'
type MergeRequestHubTab = 'waiting' | 'assigned' | 'created' | 'todos' | 'recent' | 'search'

const hubTabs: Array<{ label: string; value: MergeRequestHubTab }> = [
  { label: 'レビュー依頼', value: 'waiting' },
  { label: '担当', value: 'assigned' },
  { label: '作成', value: 'created' },
  { label: 'To-Do', value: 'todos' },
  { label: '最近開いた', value: 'recent' },
  { label: '検索', value: 'search' },
]

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
  const listParams = useMemo(() => withoutSelection(params), [params])
  const listKey = JSON.stringify(listParams)

  const navigate = useCallback((nextRoute: ClientRoute, nextParams?: Record<string, string>) => {
    const hash = locationToHash(nextRoute, nextParams ?? {})
    if (window.location.hash === hash) return
    // Entries showing an MR remember the list it was opened from and how many
    // entries ago that list was, so returning to the list can go back instead
    // of adding an entry that Back would turn into the MR again.
    const next = readClientLocation(true, hash)
    const listOfNext = next.params.mr ? locationToHash(next.route, withoutSelection(next.params)) : null
    const current = readClientLocation(true)
    const previous = readMrHistoryState(window.history.state)
    let state: MrHistoryState | null = null
    if (listOfNext && current.params.mr && previous?.list === listOfNext) state = { depth: previous.depth + 1, list: listOfNext }
    else if (listOfNext && !current.params.mr && locationToHash(current.route, current.params) === listOfNext) state = { depth: 1, list: listOfNext }
    window.history.pushState(state, '', hash)
    globalThis.dispatchEvent(new Event('gitlab-client-location-change'))
  }, [])

  const select = useCallback((ref: MrRef | null) => {
    const current = readClientLocation(Boolean(session))
    const targetRoute = current.route === 'settings' ? 'recent' : current.route
    const base: Record<string, string> = targetRoute === current.route ? withoutSelection(current.params) : {}
    if (ref && current.params.mr === `${ref.projectId}-${ref.iid}` && current.params.tab) base.tab = current.params.tab
    navigate(targetRoute, ref ? { ...base, mr: `${ref.projectId}-${ref.iid}` } : base)
  }, [navigate, session])

  // Back to the list an MR was opened from: through history when the list is
  // the entry it came from, so Back does not reopen the MR afterwards.
  const returnToList = useCallback(() => {
    const current = readClientLocation(Boolean(session))
    const list = locationToHash(current.route, withoutSelection(current.params))
    const history = readMrHistoryState(window.history.state)
    if (current.route !== 'settings' && current.params.mr && history?.list === list) window.history.go(-history.depth)
    else select(null)
  }, [select, session])

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
      if (modifier && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        if (route !== 'projects' && route !== 'mrs') navigate('mrs')
        else if (selected) returnToList()
        else {
          globalThis.dispatchEvent(new Event('gitlab-focus-project-search'))
          return
        }
        globalThis.setTimeout(() => globalThis.dispatchEvent(new Event('gitlab-focus-project-search')), 0)
        return
      }
      if (event.defaultPrevented || modifier || event.altKey || isEditableTarget(event.target) || document.querySelector('[role="dialog"]')) return
      if (event.key === 'j' || event.key === 'k') {
        const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-list-pane] [data-list-row="true"]'))
        if (rows.length === 0) return
        event.preventDefault()
        // On the list J/K move the focus; on an open MR they open the next or
        // previous MR of the list it was opened from.
        const current = selected ? rows.findIndex((row) => row.dataset.selected === 'true') : rows.indexOf(document.activeElement as HTMLElement)
        const next = current < 0 ? 0 : Math.min(rows.length - 1, Math.max(0, current + (event.key === 'j' ? 1 : -1)))
        if (next === current) return
        if (selected) rows[next].click()
        else { rows[next].focus(); rows[next].scrollIntoView?.({ block: 'nearest' }) }
        return
      }
      if (event.key === '/' && !selected) {
        event.preventDefault()
        globalThis.dispatchEvent(new Event('gitlab-focus-project-search'))
        return
      }
      if (event.key === 'Escape' && selected) returnToList()
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [navigate, returnToList, route, select, selected])

  const openProject = (nextProject: Project) => {
    navigate('mrs', { projectId: nextProject.id, projectName: nextProject.name })
  }

  const openProjectId = (nextProjectId: string, name?: string) => {
    navigate('mrs', { projectId: nextProjectId, projectName: name || `プロジェクト ${nextProjectId}` })
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

  const personal = personalQueueFor(listParams, session?.user.id)
  // The personal queues, To-Do, history and search share one list screen with tabs.
  const hubTab: MergeRequestHubTab | null = route === 'todos' || route === 'recent' ? route : route === 'mrs' ? personal ?? (params.projectName ? null : 'search') : null
  const lastHubLocation = useRef<{ route: ClientRoute; params: Record<string, string> }>({ params: defaultQueue, route: 'mrs' })
  useEffect(() => {
    if (hubTab) lastHubLocation.current = { params: listParams, route }
  }, [hubTab, listParams, route])
  const mergeRequest = openedMergeRequest?.sessionKey === sessionKey ? openedMergeRequest.mergeRequest : null
  const waitingForSessionRestore = !session && status === 'checking' && !window.location.hash

  const openSearch = () => {
    navigate('mrs')
    globalThis.setTimeout(() => globalThis.dispatchEvent(new Event('gitlab-focus-project-search')), 0)
  }
  const openHubTab = (tab: MergeRequestHubTab) => {
    if (tab === 'waiting') navigate('mrs', { reviewer: 'self', state: 'opened' })
    else if (tab === 'assigned') navigate('mrs', { assignee: 'self', state: 'opened' })
    else if (tab === 'created') navigate('mrs', session ? { authorId: session.user.id, state: 'opened' } : {})
    else if (tab === 'search') openSearch()
    else navigate(tab)
  }
  function openLastHub() {
    const last = lastHubLocation.current
    navigate(last.route, last.params)
  }
  // Opening by URL is a one-off action of the MR list, beside its tabs.
  const hubNavigation = hubTab ? <Stack direction="row" sx={{ alignItems: 'center', minWidth: 0 }}>
    <Tabs aria-label="MR一覧の切り替え" onChange={(_, value: MergeRequestHubTab) => openHubTab(value)} scrollButtons={false} sx={{ flex: 1, minWidth: 0 }} value={hubTab} variant="scrollable">
      {hubTabs.map((tab) => <Tab key={tab.value} label={tab.label} value={tab.value} />)}
    </Tabs>
    <Tooltip title="MR URLから開く (Ctrl+O)"><IconButton aria-label="MR URLから開く" onClick={() => setOpenUrlDialog(true)}><LinkRoundedIcon /></IconButton></Tooltip>
  </Stack> : undefined
  // A project's screen shows its name beside tabs for its MRs and its branches.
  const projectTab = route === 'branches' ? 'branches' : route === 'mrs' && hubTab === null && params.projectId && params.projectName ? 'mrs' : null
  const projectNavigation = projectTab ? <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', minWidth: 0 }}>
    <Typography component="div" noWrap sx={{ flexShrink: 1, minWidth: 0 }} variant="h1">{params.projectName}</Typography>
    <Tabs aria-label="プロジェクトの表示" onChange={(_, value: 'mrs' | 'branches') => navigate(value, { projectId: params.projectId, projectName: params.projectName })} scrollButtons={false} sx={{ flexShrink: 0 }} value={projectTab} variant="scrollable">
      {/* Choosing MR again, e.g. after a branch's MRs, returns to all the project's MRs. */}
      <Tab label="MR" onClick={() => { if (projectTab === 'mrs' && Object.keys(listParams).some((key) => key !== 'projectId' && key !== 'projectName')) navigate('mrs', { projectId: params.projectId, projectName: params.projectName }) }} value="mrs" />
      <Tab label="ブランチ" value="branches" />
    </Tabs>
  </Stack> : undefined
  const backLabel = route === 'branches' && params.projectName ? `${params.projectName}に戻る` : hubTab ? `${hubTabs.find((tab) => tab.value === hubTab)?.label}に戻る` : route === 'mrs' && params.projectName ? `${params.projectName}に戻る` : route === 'projects' ? 'プロジェクトに戻る' : '一覧に戻る'

  // Places only; one-off actions such as opening a URL sit beside the search box.
  // An open MR is marked by its tab below, not by these places.
  const projectsSelected = !selected && (route === 'projects' || route === 'branches' || (route === 'mrs' && hubTab === null))

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
          <Box component="nav" aria-label="GitLab client navigation" sx={{ display: 'flex', flex: 1, flexDirection: 'column' }}>
            <List disablePadding>
              <ClientNavItem collapsed={sidebarIsCollapsed} icon={<RateReviewOutlinedIcon />} label="MR一覧" onClick={openLastHub} selected={!selected && hubTab !== null} title="MR一覧" />
              <ClientNavItem collapsed={sidebarIsCollapsed} icon={<FolderOutlinedIcon />} label="プロジェクト" onClick={() => navigate('projects')} selected={projectsSelected} title="プロジェクト" />
            </List>
            <MergeRequestTabs collapsed={sidebarIsCollapsed} onOpen={openMergeRequestRef} selected={selected} />
          </Box>
          {/* The account and the settings are one entry: theme and connection both live in the settings. */}
          <Tooltip placement="right" title={sidebarIsCollapsed ? `設定 · ${session ? `${session.user.name} @${session.user.username}` : '未接続'}` : ''}>
            <ListItemButton aria-current={route === 'settings' ? 'page' : undefined} aria-label="設定" onClick={() => navigate('settings')} selected={route === 'settings'} sx={{ borderTop: 1, borderColor: 'divider', color: 'text.secondary', flexGrow: 0, gap: 1, justifyContent: sidebarIsCollapsed ? 'center' : 'initial', minHeight: 40, mt: 1, px: sidebarIsCollapsed ? 0 : 1, py: 0.75, '&:hover': { color: 'text.primary' }, '&.Mui-selected': { bgcolor: 'action.selected', color: 'text.primary' } }}>
              <Box component="span" sx={{ display: 'flex', flexShrink: 0 }}>{session ? <GitLabUserAvatar sessionId={session.id} size={24} user={session.user} /> : <Box sx={{ bgcolor: 'action.selected', borderRadius: '50%', height: 24, width: 24 }} />}</Box>
              {sidebarIsCollapsed ? null : <Typography color="inherit" noWrap sx={{ flex: 1, minWidth: 0 }} variant="caption">{session ? `@${session.user.username}` : '未接続'}</Typography>}
              {sidebarIsCollapsed ? null : <SettingsOutlinedIcon sx={{ fontSize: 18 }} />}
            </ListItemButton>
          </Tooltip>
        </Box>

        <Box sx={{ display: 'flex', flex: 1, flexDirection: 'column', minWidth: 0 }}>
          <UpdatePanel autoInstallAllowed={autoInstallAllowed} compact notificationOnly />
          <OpenMergeRequestDialog open={openUrlDialog} onClose={() => setOpenUrlDialog(false)} onOpen={openMergeRequestRef} />
          <Box key={sessionKey} sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
            {/* The same pane as the restored screen, so nothing moves when it arrives. */}
            {waitingForSessionRestore ? <Box aria-label="一覧" component="section" sx={{ bgcolor: 'surface.list', flex: 1, minWidth: 0 }}><RestoreSessionPanel /></Box> : null}
            {!waitingForSessionRestore && route === 'settings' ? (
              <Box component="main" sx={{ flex: 1, overflow: 'auto' }}>
                <Box sx={{ maxWidth: 880, mx: 'auto', px: { md: 5, xs: 2.5 }, py: 3.5 }}><SettingsView mode={mode} onModeChange={onModeChange} /></Box>
              </Box>
            ) : null}
            {!waitingForSessionRestore && route !== 'settings' ? <>
              {/* A list or one MR fills the width; the list stays mounted under an open MR so its input, scroll and J/K order survive. */}
              <Box aria-label="一覧" component="section" data-list-pane="true" sx={{ bgcolor: 'surface.list', display: selected ? 'none' : 'flex', flex: 1, flexDirection: 'column', minHeight: 0, minWidth: 0 }}>
                {route === 'projects' ? <ProjectView onOpenProject={openProject} onOpenProjectId={openProjectId} /> : null}
                {route === 'mrs' ? <MergeRequestList key={`${session?.instanceUrl ?? 'anonymous'}:${session?.user.id ?? 'anonymous'}:${listKey}`} initialParams={listParams} navigation={hubNavigation ?? projectNavigation} onOpenMergeRequest={openMergeRequest} onSearchStateChange={updateMergeRequestLocation} projectId={params.projectId} projectName={params.projectName} selected={selected} /> : null}
                {route === 'branches' ? <BranchList key={params.projectId} navigation={projectNavigation} onShowMergeRequests={(branch) => navigate('mrs', { projectId: params.projectId, projectName: params.projectName ?? `プロジェクト ${params.projectId}`, sourceBranch: branch, state: 'all' })} projectId={params.projectId} projectName={params.projectName ?? `プロジェクト ${params.projectId}`} /> : null}
                {route === 'todos' ? <TodoView navigation={hubNavigation} onOpen={openMergeRequestRef} selected={selected} /> : null}
                {route === 'recent' ? <RecentMergeRequests navigation={hubNavigation} onOpen={openMergeRequestRef} selected={selected} /> : null}
              </Box>
              {selected ? <Box component="main" sx={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
                <MergeRequestRoute
                  initialMergeRequest={mergeRequest}
                  key={`${selected.projectId}:${selected.iid}`}
                  backLabel={backLabel}
                  onBack={returnToList}
                  onOpenProject={(projectPath) => openProjectId(selected.projectId, projectPath)}
                  onTabChange={(tab) => {
                    // Each tab is a history entry, so Back returns to the previous tab.
                    const next = { ...params }
                    if (tab === 'discussion') delete next.tab
                    else next.tab = tab
                    navigate(route, next)
                  }}
                  selected={selected}
                  tab={parseTab(params.tab)}
                />
              </Box> : null}
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

function SettingsView({ mode, onModeChange }: { mode: 'light' | 'dark'; onModeChange: () => void }) {
  const { session } = useConnection()
  return <Box>
    <Box sx={{ pb: 2.5 }}>
      <Typography component="h1" variant="h1">設定</Typography>
      <Typography color="text.secondary" sx={{ mt: 0.5 }} variant="body2">GitLabへの接続、表示、この端末に保存するデータを管理します。</Typography>
    </Box>
    <SettingsSection description="接続先とアクセス方法" id="settings-connection" title="GitLab接続"><ConnectionView /></SettingsSection>
    <SettingsSection description="この端末での配色" id="settings-display" title="表示">
      <ToggleButtonGroup aria-label="配色" exclusive onChange={(_, value: 'light' | 'dark' | null) => { if (value && value !== mode) onModeChange() }} size="small" value={mode}>
        <ToggleButton value="light">ライト</ToggleButton>
        <ToggleButton value="dark">ダーク</ToggleButton>
      </ToggleButtonGroup>
    </SettingsSection>
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

function MergeRequestRoute({ backLabel, initialMergeRequest, onBack, onOpenProject, onTabChange, selected, tab }: { backLabel: string; initialMergeRequest: MergeRequest | null; onBack: () => void; onOpenProject: (projectPath?: string) => void; onTabChange: (tab: ReviewTab) => void; selected: MrRef; tab: ReviewTab }) {
  const { session } = useConnection()
  const query = useMemo(() => ({ iid: selected.iid, kind: 'mr' as const, projectId: selected.projectId }), [selected.iid, selected.projectId])
  const lookup = useGitLabQuery(session?.id ?? null, query)
  const accessDenied = lookup.error?.code === 'AUTH_REQUIRED' || lookup.error?.code === 'FORBIDDEN' || lookup.error?.code === 'NOT_FOUND'
  const initialMatchesRoute = Boolean(initialMergeRequest && selected.projectId === initialMergeRequest.projectId && selected.iid === initialMergeRequest.iid)
  const mergeRequest = accessDenied ? null : lookup.data ?? (initialMatchesRoute ? initialMergeRequest : null)
  if (!mergeRequest) {
    return lookup.loading
      ? <MergeRequestSkeleton />
      : <PaneEmpty description="検索から開き直してください。" title="このMRを復元できませんでした。"><Button onClick={onBack} startIcon={<ArrowBackRoundedIcon />}>{backLabel}</Button></PaneEmpty>
  }
  return <MergeRequestDetail initialMergeRequest={mergeRequest} backLabel={backLabel} key={`${mergeRequest.projectId}:${mergeRequest.iid}`} onBack={onBack} onOpenProject={() => onOpenProject(mergeRequest.projectPath ?? undefined)} onTabChange={onTabChange} tab={tab} />
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
  // The former pinned list became the sidebar's pinned tabs; its links show the history.
  let route: ClientRoute | null = routeValue === 'pinned' ? 'recent' : routeValue === 'projects' || routeValue === 'mrs' || routeValue === 'branches' || routeValue === 'settings' || routeValue === 'todos' || routeValue === 'recent' ? routeValue : null
  if (routeValue === 'mr' && params.projectId && params.iid) {
    // Older links opened a full-page detail; show it beside the default queue.
    route = 'mrs'
    params = { ...defaultQueue, mr: `${params.projectId}-${params.iid}` }
  }
  if (!route) {
    route = hasSession ? 'mrs' : 'settings'
    params = hasSession ? defaultQueue : {}
  } else if (route === 'branches' && !params.projectId) {
    route = 'projects'
    params = {}
  }
  if (!hasSession && route !== 'settings') {
    route = 'settings'
    params = {}
  }
  return { params, raw, route }
}

interface MrHistoryState { list: string; depth: number }

function readMrHistoryState(value: unknown): MrHistoryState | null {
  if (!value || typeof value !== 'object') return null
  const { depth, list } = value as Partial<MrHistoryState>
  return typeof list === 'string' && typeof depth === 'number' && Number.isSafeInteger(depth) && depth > 0 ? { depth, list } : null
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

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select, [role="combobox"], [contenteditable="true"]') !== null)
}
