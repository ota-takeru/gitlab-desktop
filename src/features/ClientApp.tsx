import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import InboxOutlinedIcon from '@mui/icons-material/InboxOutlined'
import MenuOpenRoundedIcon from '@mui/icons-material/MenuOpenRounded'
import MenuRoundedIcon from '@mui/icons-material/MenuRounded'
import RateReviewOutlinedIcon from '@mui/icons-material/RateReviewOutlined'
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined'
import SourceOutlinedIcon from '@mui/icons-material/SourceOutlined'
import LinkRoundedIcon from '@mui/icons-material/LinkRounded'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import IconButton from '@mui/material/IconButton'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import Stack from '@mui/material/Stack'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import useMediaQuery from '@mui/material/useMediaQuery'
import { QueryCache, QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import { AppErrorBoundary } from '../components/AppErrorBoundary'
import { ClientNavItem } from '../components/ClientNavItem'
import { useConfirm } from '../components/Feedback'
import { PaneEmpty } from '../components/Pane'
import { delayedRevealSx } from '../components/paneSx'
import { useReorder } from '../components/useReorder'
import { SettingsSection } from '../components/SettingsSection'
import { StatusBar } from '../components/StatusBar'
import { UpdatePanel } from '../components/UpdatePanel'
import { clearLocalDrafts } from '../lib/localDrafts'
import { getRuntimeInfo, isTauri } from '../lib/runtime'
import type { GitLabCommandError, GitLabSnapshot, MergeRequest, Project } from '../types/gitlab'
import type { ColorMode, ColorPreference } from './colorMode'
import { reportGitLabConnectivity, resetGitLabConnectivity, useGitLabConnectivity } from './connectivity'
import { KeyboardShortcutsDialog } from './KeyboardShortcutsDialog'
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
const SIDEBAR_WIDTH_KEY = 'gitlab-desktop:sidebar-width'
const SIDEBAR_WIDTH = { default: 208, max: 420, min: 180 }
const SIDEBAR_COLLAPSED_WIDTH = 52

function readSidebarWidth(): number {
  try {
    const value = Number(globalThis.localStorage?.getItem(SIDEBAR_WIDTH_KEY))
    return Number.isFinite(value) && value > 0 ? clampSidebarWidth(value) : SIDEBAR_WIDTH.default
  } catch {
    return SIDEBAR_WIDTH.default
  }
}

function clampSidebarWidth(value: number): number {
  return Math.round(Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, value)))
}

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

type ClientRoute = 'projects' | 'mrs' | 'branches' | 'settings' | 'todos'
/** The MR list's tabs are lists of MRs only; To-Do and the history are places of their own in the sidebar. */
type MergeRequestHubTab = 'waiting' | 'assigned' | 'created' | 'search'

const hubTabs: Array<{ label: string; value: MergeRequestHubTab }> = [
  { label: 'レビュー依頼', value: 'waiting' },
  { label: '担当', value: 'assigned' },
  { label: '作成', value: 'created' },
  { label: '検索', value: 'search' },
]
const HUB_TAB_ORDER_KEY = 'gitlab-desktop:mr-hub-tab-order'

/** The reader's order of the MR list's tabs; the first one is where the MR list starts. */
function readHubTabOrder(): MergeRequestHubTab[] {
  const known = hubTabs.map((tab) => tab.value)
  let stored: unknown
  try { stored = JSON.parse(globalThis.localStorage?.getItem(HUB_TAB_ORDER_KEY) ?? 'null') } catch { stored = null }
  const order = Array.isArray(stored) ? stored.filter((value, index, all): value is MergeRequestHubTab => known.includes(value) && all.indexOf(value) === index) : []
  return [...order, ...known.filter((value) => !order.includes(value))]
}

function writeHubTabOrder(order: MergeRequestHubTab[]): void {
  try { globalThis.localStorage?.setItem(HUB_TAB_ORDER_KEY, JSON.stringify(order)) } catch { /* The order still applies until the window is reopened. */ }
}

/** Where a tab of the MR list leads. Without the user's ID, "created" falls back to the review queue. */
function hubTabLocation(tab: MergeRequestHubTab, userId: string | undefined): { route: ClientRoute; params: Record<string, string> } {
  if (tab === 'search') return { params: {}, route: 'mrs' }
  if (tab === 'assigned') return { params: { assignee: 'self', state: 'opened' }, route: 'mrs' }
  if (tab === 'created' && userId) return { params: { authorId: userId, state: 'opened' }, route: 'mrs' }
  return { params: { reviewer: 'self', state: 'opened' }, route: 'mrs' }
}

interface ColorPreferenceProps { colorPreference: ColorPreference; onColorPreferenceChange: (preference: ColorPreference) => void }

/** Each finished GitLab query tells the footer whether GitLab was reachable; a refresh that failed but kept saved data still counts as unreachable. */
function trackConnectivity() {
  return new QueryCache({
    onError: (error) => reportGitLabConnectivity(error as GitLabCommandError),
    onSuccess: (data) => {
      const loaded = data as { error?: GitLabCommandError | null; snapshot?: GitLabSnapshot<unknown> | null } | undefined
      reportGitLabConnectivity(loaded?.error ?? null, Boolean(loaded?.snapshot))
    },
  })
}

/** The development fixtures still pass a fixed light/dark mode with a toggle. */
type ClientAppProps = ColorPreferenceProps | { mode: ColorMode; onModeChange: () => void }

export function ClientApp(props: ClientAppProps) {
  const { colorPreference, onColorPreferenceChange }: ColorPreferenceProps = 'colorPreference' in props
    ? props
    : { colorPreference: props.mode, onColorPreferenceChange: (next) => { if (next !== props.mode && next !== 'system') props.onModeChange() } }
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { gcTime: 15 * 60_000, refetchOnWindowFocus: false, retry: false, staleTime: 30_000 } }, queryCache: trackConnectivity() }))
  useEffect(() => {
    const handleWorkspaceReset = () => clearComposerBuffers()
    globalThis.addEventListener('gitlab-explicit-logout', handleWorkspaceReset)
    globalThis.addEventListener('gitlab-account-replaced', handleWorkspaceReset)
    return () => {
      globalThis.removeEventListener('gitlab-explicit-logout', handleWorkspaceReset)
      globalThis.removeEventListener('gitlab-account-replaced', handleWorkspaceReset)
    }
  }, [])
  return <QueryClientProvider client={queryClient}><ConnectionProvider><SessionScopedWorkspace colorPreference={colorPreference} onColorPreferenceChange={onColorPreferenceChange} /></ConnectionProvider></QueryClientProvider>
}

function SessionScopedWorkspace({ colorPreference, onColorPreferenceChange }: ColorPreferenceProps) {
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
    // Reachability belongs to one session's requests.
    resetGitLabConnectivity()
  }, [queryClient, sessionKey])
  return <AutoUpdateSafetyProvider><SessionWorkspaceContents colorPreference={colorPreference} onColorPreferenceChange={onColorPreferenceChange} status={status} sessionKey={session ? `${session.instanceUrl}:${session.user.id}:${session.id}` : 'disconnected'} /></AutoUpdateSafetyProvider>
}

function SessionWorkspaceContents({ colorPreference, onColorPreferenceChange, sessionKey, status }: ColorPreferenceProps & { sessionKey: string; status: string }) {
  const { session } = useConnection()
  const workspace = usePersonalWorkspace(session)
  const autoInstallAllowed = useAutoUpdateAllowed() && status !== 'checking'
  // The updater stays mounted across authentication resets so its install guard
  // and result remain active for the lifetime of the app.
  return <Box sx={{ bgcolor: 'background.default', display: 'flex', flexDirection: 'column', height: '100vh' }}>
    <WindowCloseProtection />
    <QueryRefreshPolicy value={workspace.settings.autoRefresh && autoInstallAllowed}>
      <WorkspaceMonitor key={sessionKey} />
      <ClientWorkspace colorPreference={colorPreference} onColorPreferenceChange={onColorPreferenceChange} autoInstallAllowed={autoInstallAllowed} sessionKey={sessionKey} status={status} />
    </QueryRefreshPolicy>
  </Box>
}

function ClientWorkspace({ colorPreference, onColorPreferenceChange, autoInstallAllowed, sessionKey, status }: ColorPreferenceProps & { autoInstallAllowed: boolean; sessionKey: string; status: string }) {
  const { reauthRequired, session } = useConnection()
  const workspace = usePersonalWorkspace(session)
  const locationHash = useSyncExternalStore(subscribeToClientLocation, getClientLocationHash, getClientLocationHash)
  // An expired token keeps the screen where it was, so reconnecting returns to it.
  const awaitingReauth = !session && Boolean(reauthRequired)
  const location = readClientLocation(Boolean(session) || awaitingReauth, locationHash, session?.user.id)
  const [reconnectOpen, setReconnectOpen] = useState(false)
  if (session && reconnectOpen) setReconnectOpen(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [openedMergeRequest, setOpenedMergeRequest] = useState<{ sessionKey: string; mergeRequest: MergeRequest } | null>(null)
  const [openUrlDialog, setOpenUrlDialog] = useState(false)
  const isNarrowNav = useMediaQuery('(max-width:1000px)')
  // The reader's collapse choice is kept; narrow windows start with icons only.
  const [sidebarCollapsedBrowsing, setSidebarCollapsedBrowsing] = useState(() => readLayoutPreference(SIDEBAR_COLLAPSED_BROWSING_KEY, false))
  const [narrowSidebarExpanded, setNarrowSidebarExpanded] = useState(false)
  const { route, params } = location
  const selected = parseSelection(params.mr)
  // An open MR keeps the navigation as it is: the MR already has the whole width beside it.
  const sidebarIsCollapsed = isNarrowNav ? !narrowSidebarExpanded : sidebarCollapsedBrowsing
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth)
  const [resizing, setResizing] = useState(false)
  const [peeking, setPeeking] = useState(false)
  const peekTimer = useRef<ReturnType<typeof globalThis.setTimeout> | undefined>(undefined)
  const startPeek = () => {
    if (!sidebarIsCollapsed) return
    globalThis.clearTimeout(peekTimer.current)
    peekTimer.current = globalThis.setTimeout(() => setPeeking(true), 300)
  }
  const endPeek = () => {
    globalThis.clearTimeout(peekTimer.current)
    setPeeking(false)
  }
  useEffect(() => () => globalThis.clearTimeout(peekTimer.current), [])
  const navCollapsed = sidebarIsCollapsed && !peeking
  // In a narrow window an expanded navigation lies over the page, like the peek, instead of taking its width.
  const navOverlays = peeking || (isNarrowNav && !sidebarIsCollapsed)
  const toggleSidebar = () => {
    if (isNarrowNav) {
      setNarrowSidebarExpanded((current) => !current)
      return
    }
    const next = !sidebarIsCollapsed
    setSidebarCollapsedBrowsing(next)
    writeLayoutPreference(SIDEBAR_COLLAPSED_BROWSING_KEY, next)
  }
  const listParams = useMemo(() => withoutSelection(params), [params])
  const listKey = JSON.stringify(listParams)
  // The MR list reads its parameters once, so a different list remounts it. A
  // search the list applied itself only rewrites the URL, so it stays mounted
  // with its focus, open conditions and preview.
  const [listMount, setListMount] = useState({ key: listKey, seen: listKey })
  const [listEmittedKey, setListEmittedKey] = useState<string | null>(null)
  if (listMount.seen !== listKey) {
    setListMount({ key: listKey === listEmittedKey ? listMount.key : listKey, seen: listKey })
    setListEmittedKey(null)
  }
  // The MR last opened from the list gets the focus back when the list shows again.
  const [recentMrId, setRecentMrId] = useState<string | null>(selected ? params.mr : null)
  if (selected && params.mr !== recentMrId) setRecentMrId(params.mr)
  const searchingAllMrs = route === 'mrs' && !listParams.projectName && personalQueueFor(listParams, session?.user.id) === null

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
    // From the settings an MR opens over the list the MR list starts with.
    const start = hubTabLocation(readHubTabOrder()[0], session?.user.id)
    const targetRoute = current.route === 'settings' ? start.route : current.route
    const base: Record<string, string> = targetRoute === current.route ? withoutSelection(current.params) : { ...start.params }
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
    if (!session && (status === 'checking' || reauthRequired)) return
    if (window.location.hash !== locationHash) return
    const canonicalHash = locationToHash(location.route, location.params)
    if (window.location.hash !== canonicalHash) {
      window.history.replaceState(window.history.state, '', canonicalHash)
      globalThis.dispatchEvent(new Event('gitlab-client-location-change'))
    }
  }, [location.params, location.route, location.raw, locationHash, reauthRequired, session, status])

  const selectedMrId = selected ? params.mr : null
  const previousSelectedMrId = useRef(selectedMrId)
  useEffect(() => {
    const returnedFrom = previousSelectedMrId.current
    previousSelectedMrId.current = selectedMrId
    if (!returnedFrom || selectedMrId || !recentMrId || !parseSelection(recentMrId)) return
    // The list is visible again in this commit; the id only holds digits and a dash.
    const row = document.querySelector<HTMLElement>(`[data-list-pane] [data-mr-id="${recentMrId}"]`)
    if (!row) return
    row.focus()
    row.scrollIntoView?.({ block: 'nearest' })
  }, [recentMrId, selectedMrId])

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
      // Text input keeps its own keys: Ctrl+K in a comment must not leave the MR.
      const editing = isEditableTarget(event.target)
      if (modifier && !editing && session && event.key.toLowerCase() === 'o') { event.preventDefault(); setOpenUrlDialog(true); return }
      if (modifier && !editing && session && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        // Ctrl+K searches all MRs; "/" searches within the list on screen.
        if (searchingAllMrs && !selected) {
          globalThis.dispatchEvent(new Event('gitlab-focus-project-search'))
          return
        }
        if (searchingAllMrs) returnToList()
        else navigate('mrs')
        globalThis.setTimeout(() => globalThis.dispatchEvent(new Event('gitlab-focus-project-search')), 0)
        return
      }
      if (event.defaultPrevented || modifier || event.altKey || editing || document.querySelector('[role="dialog"]')) return
      if (event.key === '?') {
        event.preventDefault()
        setShortcutsOpen(true)
        return
      }
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
      // Esc first closes what has the focus (a composer, its toolbar, a menu); only then does it leave the MR.
      if (event.key === 'Escape' && selected && !isInsideControlGroup(event.target)) returnToList()
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [navigate, returnToList, route, searchingAllMrs, select, selected, session])

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
    setListEmittedKey(JSON.stringify(withoutSelection(readClientLocation(true, hash).params)))
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
  const hubTab: MergeRequestHubTab | null = route === 'mrs' ? personal ?? (params.projectName ? null : 'search') : null
  const [hubOrder, setHubOrder] = useState(readHubTabOrder)
  const hubReorder = useReorder({ axis: 'x', keys: hubOrder, onMove: (key, toIndex) => {
    const next = hubOrder.filter((value) => value !== key)
    next.splice(toIndex, 0, key as MergeRequestHubTab)
    setHubOrder(next)
    writeHubTabOrder(next)
  } })
  // Until a tab of the MR list is shown, the MR list starts at the reader's first tab.
  const lastHubLocation = useRef<{ route: ClientRoute; params: Record<string, string> }>(hubTabLocation(hubOrder[0], session?.user.id))
  useEffect(() => {
    if (hubTab) lastHubLocation.current = { params: listParams, route }
  }, [hubTab, listParams, route])
  const mergeRequest = openedMergeRequest?.sessionKey === sessionKey ? openedMergeRequest.mergeRequest : null
  // Only the first restore at startup: a later connect attempt keeps the form on screen.
  const [initialRestoreSettled, setInitialRestoreSettled] = useState(status !== 'checking')
  if (!initialRestoreSettled && status !== 'checking') setInitialRestoreSettled(true)
  const waitingForSessionRestore = !session && status === 'checking' && !initialRestoreSettled

  const openSearch = () => {
    navigate('mrs')
    globalThis.setTimeout(() => globalThis.dispatchEvent(new Event('gitlab-focus-project-search')), 0)
  }
  const openHubTab = (tab: MergeRequestHubTab) => {
    if (tab === 'search') openSearch()
    else {
      const next = hubTabLocation(tab, session?.user.id)
      navigate(next.route, next.params)
    }
  }
  function openLastHub() {
    const last = lastHubLocation.current
    navigate(last.route, last.params)
  }
  // Opening by URL is a one-off action of the MR list, beside its tabs.
  const hubNavigation = hubTab ? <Stack direction="row" sx={{ alignItems: 'center', minWidth: 0 }}>
    {/* The tabs can be dragged, or moved with Alt+←/→, into the reader's order. */}
    <Tabs aria-label="MR一覧の切り替え" onChange={(_, value: MergeRequestHubTab) => openHubTab(value)} scrollButtons={false} sx={{ flex: 1, minWidth: 0 }} value={hubTab} variant="scrollable" {...hubReorder.containerProps}>
      {hubOrder.map((value) => <Tab aria-description="Alt+←/→で並べ替え" key={value} label={hubTabs.find((tab) => tab.value === value)?.label} sx={{ '&[data-reorder-dragging]': { bgcolor: 'surface.raised', borderRadius: 1, boxShadow: 4, cursor: 'grabbing' } }} value={value} {...hubReorder.itemProps(value)} />)}
    </Tabs>
    <Tooltip title="MR URLから開く (Ctrl+O)"><IconButton aria-label="MR URLから開く" onClick={() => setOpenUrlDialog(true)}><LinkRoundedIcon /></IconButton></Tooltip>
  </Stack> : undefined
  // A project's screen shows its name beside tabs for its MRs and its branches.
  const projectTab = route === 'branches' ? 'branches' : route === 'mrs' && hubTab === null && params.projectId && params.projectName ? 'mrs' : null
  const projectNavigation = projectTab ? <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', minWidth: 0 }}>
    <Tooltip title={params.projectName ?? ''}><Typography component="div" noWrap sx={{ flexShrink: 1, minWidth: 0 }} variant="h1">{params.projectName}</Typography></Tooltip>
    <Tabs aria-label="プロジェクトの表示" onChange={(_, value: 'mrs' | 'branches') => navigate(value, { projectId: params.projectId, projectName: params.projectName })} scrollButtons={false} sx={{ flexShrink: 0 }} value={projectTab} variant="scrollable">
      {/* Choosing MR again, e.g. after a branch's MRs, returns to all the project's MRs. */}
      <Tab label="MR" onClick={() => { if (projectTab === 'mrs' && Object.keys(listParams).some((key) => key !== 'projectId' && key !== 'projectName')) navigate('mrs', { projectId: params.projectId, projectName: params.projectName }) }} value="mrs" />
      <Tab label="ブランチ" value="branches" />
    </Tabs>
  </Stack> : undefined
  const backLabel = route === 'branches' && params.projectName ? `${params.projectName}に戻る` : hubTab ? `${hubTabs.find((tab) => tab.value === hubTab)?.label}に戻る` : route === 'todos' ? 'To-Doに戻る' : route === 'mrs' && params.projectName ? `${params.projectName}に戻る` : route === 'projects' ? 'プロジェクトに戻る' : '一覧に戻る'

  // Places only; one-off actions such as opening a URL sit beside the search box.
  // An open MR is marked by its tab below, not by these places.
  const projectsSelected = !selected && (route === 'projects' || route === 'branches' || (route === 'mrs' && hubTab === null))

  return (
    <Box sx={{ display: 'flex', flex: 1, flexDirection: 'column', minHeight: 0 }}>
      <Box sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Collapsed, the navigation shows in full over the page while the pointer rests on it. */}
        <Box onMouseEnter={startPeek} onMouseLeave={endPeek} sx={{ flexShrink: 0, position: 'relative', transition: resizing ? 'none' : 'width 120ms', width: sidebarIsCollapsed || isNarrowNav ? SIDEBAR_COLLAPSED_WIDTH : sidebarWidth, zIndex: navOverlays ? 'drawer' : 'auto', '@media (prefers-reduced-motion: reduce)': { transition: 'none' } }}>
        <Box component="aside" sx={{ bgcolor: 'surface.nav', borderRight: 1, borderColor: 'divider', bottom: 0, boxShadow: navOverlays ? 8 : 'none', display: 'flex', flexDirection: 'column', left: 0, overflow: 'hidden', position: 'absolute', px: 1, py: 1, top: 0, transition: resizing ? 'none' : 'width 120ms', width: navCollapsed ? SIDEBAR_COLLAPSED_WIDTH : sidebarWidth, '@media (prefers-reduced-motion: reduce)': { transition: 'none' } }}>
          <Stack direction="row" sx={{ alignItems: 'center', justifyContent: navCollapsed ? 'center' : 'space-between', minHeight: 36, mb: 1, pl: navCollapsed ? 0 : 1 }}>
            {navCollapsed ? null : <Typography component="div" noWrap variant="h3">GitLab Desktop</Typography>}
            <Tooltip placement="right" title={sidebarIsCollapsed ? 'ナビゲーションを展開' : 'ナビゲーションを折りたたむ'}>
              <IconButton
                aria-label={sidebarIsCollapsed ? 'ナビゲーションを展開' : 'ナビゲーションを折りたたむ'}
                onClick={() => { setPeeking(false); toggleSidebar() }}
              >
                {sidebarIsCollapsed ? <MenuRoundedIcon /> : <MenuOpenRoundedIcon />}
              </IconButton>
            </Tooltip>
          </Stack>
          {/* Only the tabs scroll, so the places above and the settings below stay in view. */}
          <Box component="nav" aria-label="GitLab client navigation" sx={{ display: 'flex', flex: 1, flexDirection: 'column', minHeight: 0 }}>
            <List disablePadding>
              <ClientNavItem collapsed={navCollapsed} disabled={!session} icon={<RateReviewOutlinedIcon />} label="MR一覧" onClick={openLastHub} selected={!selected && hubTab !== null} title="MR一覧" />
              <ClientNavItem collapsed={navCollapsed} disabled={!session} icon={<InboxOutlinedIcon />} label="To-Do" onClick={() => navigate('todos')} selected={!selected && route === 'todos'} title="To-Do" />
              <ClientNavItem collapsed={navCollapsed} disabled={!session} icon={<SourceOutlinedIcon />} label="プロジェクト" onClick={() => navigate('projects')} selected={projectsSelected} title="プロジェクト" />
            </List>
            <MergeRequestTabs collapsed={navCollapsed} onOpen={openMergeRequestRef} selected={selected} />
          </Box>
          {/* The account and the settings are one entry: theme and connection both live in the settings. */}
          <Tooltip placement="right" title={navCollapsed ? `設定 · ${session ? `${session.user.name} @${session.user.username}` : '未接続'}` : ''}>
            <ListItemButton aria-current={route === 'settings' ? 'page' : undefined} aria-label={session ? `@${session.user.username} · 設定` : '設定'} onClick={() => navigate('settings')} selected={route === 'settings'} sx={{ borderTop: 1, borderColor: 'divider', color: 'text.secondary', flexGrow: 0, gap: 1, justifyContent: navCollapsed ? 'center' : 'initial', minHeight: 40, mt: 1, px: navCollapsed ? 0 : 1, py: 0.5, '&:hover': { color: 'text.primary' }, '&.Mui-selected': { bgcolor: 'action.selected', color: 'text.primary' } }}>
              <Box component="span" sx={{ display: 'flex', flexShrink: 0 }}>{session ? <GitLabUserAvatar sessionId={session.id} size={24} user={session.user} /> : <SettingsOutlinedIcon sx={{ fontSize: 20, m: 0.25 }} />}</Box>
              {navCollapsed ? null : <Typography color="inherit" noWrap sx={{ flex: 1, minWidth: 0 }} variant="caption">{session ? `@${session.user.username}` : '未接続'}</Typography>}
              {navCollapsed || !session ? null : <SettingsOutlinedIcon sx={{ fontSize: 18 }} />}
            </ListItemButton>
          </Tooltip>
        </Box>
        {sidebarIsCollapsed || isNarrowNav ? null : <SidebarResizeHandle onResize={setSidebarWidth} onResizingChange={setResizing} width={sidebarWidth} />}
        </Box>
        <Box sx={{ display: 'flex', flex: 1, flexDirection: 'column', minWidth: 0 }}>
          {awaitingReauth ? <Alert action={<Button color="inherit" onClick={() => setReconnectOpen(true)} size="small" variant="outlined">再接続</Button>} severity="warning" sx={{ borderRadius: 0, flexShrink: 0 }}>
            再認証が必要です。GitLabのトークンが使えなくなりました。未送信コメントは保持しています。
          </Alert> : null}
          <Dialog aria-labelledby="gitlab-connection-title" fullWidth maxWidth="sm" onClose={() => setReconnectOpen(false)} open={reconnectOpen && !session}>
            <DialogContent><ConnectionView /></DialogContent>
          </Dialog>
          <KeyboardShortcutsDialog onClose={() => setShortcutsOpen(false)} open={shortcutsOpen} />
          <OpenMergeRequestDialog open={openUrlDialog} onClose={() => setOpenUrlDialog(false)} onOpen={openMergeRequestRef} />
          <Box key={sessionKey} sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
            {/* The same pane as the restored screen, so nothing moves when it arrives. */}
            {waitingForSessionRestore ? <Box aria-label="一覧" component="section" sx={{ bgcolor: 'surface.list', flex: 1, minWidth: 0 }}><RestoreSessionPanel /></Box> : null}
            {!waitingForSessionRestore && route === 'settings' ? (
              <Box component="main" sx={{ flex: 1, overflow: 'auto' }}>
                <Box sx={{ maxWidth: 880, mx: 'auto', px: { md: 3, xs: 2 }, py: 3.5 }}><SettingsView autoInstallAllowed={autoInstallAllowed} colorPreference={colorPreference} onColorPreferenceChange={onColorPreferenceChange} onShowShortcuts={() => setShortcutsOpen(true)} /></Box>
              </Box>
            ) : null}
            {!waitingForSessionRestore && route !== 'settings' && awaitingReauth ? <Box aria-label="一覧" component="section" sx={{ bgcolor: 'surface.list', flex: 1, minWidth: 0 }}>
              <PaneEmpty description="再接続すると、この画面に戻ります。" title="再認証が必要です" />
            </Box> : null}
            {!waitingForSessionRestore && route !== 'settings' && !awaitingReauth ? <>
              {/* A list or one MR fills the width; the list stays mounted under an open MR so its input, scroll and J/K order survive. */}
              <Box aria-label="一覧" component="section" data-list-pane="true" sx={{ bgcolor: 'surface.list', display: selected ? 'none' : 'flex', flex: 1, flexDirection: 'column', minHeight: 0, minWidth: 0 }}>
                <AppErrorBoundary compact>
                {route === 'projects' ? <ProjectView onOpenProject={openProject} onOpenProjectId={openProjectId} /> : null}
                {route === 'mrs' ? <MergeRequestList key={`${session?.instanceUrl ?? 'anonymous'}:${session?.user.id ?? 'anonymous'}:${listMount.key}`} initialParams={listParams} navigation={hubNavigation ?? projectNavigation} onOpenMergeRequest={openMergeRequest} onSearchAll={personal ? (search) => { navigate('mrs', search ? { search } : {}); globalThis.setTimeout(() => globalThis.dispatchEvent(new Event('gitlab-focus-project-search')), 0) } : undefined} onSearchStateChange={updateMergeRequestLocation} projectId={params.projectId} projectName={params.projectName} recentMrId={recentMrId} selected={selected} /> : null}
                {route === 'branches' ? <BranchList key={params.projectId} navigation={projectNavigation} onShowMergeRequests={(branch) => navigate('mrs', { projectId: params.projectId, projectName: params.projectName ?? `プロジェクト ${params.projectId}`, sourceBranch: branch, state: 'all' })} projectId={params.projectId} projectName={params.projectName ?? `プロジェクト ${params.projectId}`} /> : null}
                {route === 'todos' ? <TodoView onOpen={openMergeRequestRef} selected={selected} /> : null}
                </AppErrorBoundary>
              </Box>
              {selected ? <Box component="main" sx={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
                <AppErrorBoundary compact key={`${selected.projectId}:${selected.iid}`}>
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
                </AppErrorBoundary>
              </Box> : null}
            </> : null}
          </Box>
        </Box>
      </Box>
      {/* Update notices live in the bar, in a slot of fixed height, so the page never shifts. */}
      <ConnectionStatusBar awaitingReauth={awaitingReauth} trailing={<>
        <UpdatePanel autoInstallAllowed={autoInstallAllowed} notificationOnly />
        <AppVersionLabel />
      </>} />
    </Box>
  )
}

/** The sidebar's right edge: drag, or focus it and use ←/→, to change the width; double-click restores it. */
function SidebarResizeHandle({ onResize, onResizingChange, width }: { onResize: (width: number) => void; onResizingChange: (resizing: boolean) => void; width: number }) {
  const save = (next: number) => {
    try { globalThis.localStorage?.setItem(SIDEBAR_WIDTH_KEY, String(next)) } catch { /* The width still applies until the window is reopened. */ }
  }
  const resizeTo = (next: number) => {
    const clamped = clampSidebarWidth(next)
    onResize(clamped)
    save(clamped)
  }
  return <Box
    aria-label="サイドバーの幅"
    aria-orientation="vertical"
    aria-valuemax={SIDEBAR_WIDTH.max}
    aria-valuemin={SIDEBAR_WIDTH.min}
    aria-valuenow={width}
    onDoubleClick={() => resizeTo(SIDEBAR_WIDTH.default)}
    onKeyDown={(event) => {
      const step = event.key === 'ArrowLeft' ? -16 : event.key === 'ArrowRight' ? 16 : 0
      if (!step) return
      event.preventDefault()
      resizeTo(width + step)
    }}
    onPointerDown={(event) => {
      if (event.button !== 0) return
      event.preventDefault()
      const startX = event.clientX
      let latest = width
      onResizingChange(true)
      document.body.style.cursor = 'col-resize'
      const move = (moveEvent: PointerEvent) => {
        latest = clampSidebarWidth(width + moveEvent.clientX - startX)
        onResize(latest)
      }
      const end = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', end)
        window.removeEventListener('pointercancel', end)
        document.body.style.cursor = ''
        onResizingChange(false)
        save(latest)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', end)
      window.addEventListener('pointercancel', end)
    }}
    role="separator"
    sx={{ bottom: 0, cursor: 'col-resize', position: 'absolute', right: -3, top: 0, width: 6, zIndex: 1, '&:hover, &:focus-visible': { bgcolor: 'primary.main', opacity: 0.4 } }}
    tabIndex={0}
    title="ドラッグで幅を変更（ダブルクリックで元に戻す）"
  />
}

/** The footer's account line: green only while GitLab answers, amber when requests fail or the token expired. */
function ConnectionStatusBar({ awaitingReauth, trailing }: { awaitingReauth: boolean; trailing: React.ReactNode }) {
  const { session } = useConnection()
  const connectivity = useGitLabConnectivity()
  const offline = globalThis.navigator?.onLine === false
  const warning = awaitingReauth || Boolean(session && connectivity.failing)
  const text = awaitingReauth
    ? '再認証が必要です · 再接続するまで表示を止めています'
    : !session
      ? '未接続 · データは表示していません'
      : connectivity.failing
        ? offline
          ? `オフライン · 保存済みデータを表示中 · ${session.instanceUrl}`
          : `GitLabに接続できません${connectivity.showingCache ? ' · 保存済みデータを表示中' : ''} · ${session.instanceUrl}`
        : `接続済み · ${session.instanceUrl} · @${session.user.username}`
  return <StatusBar tone={warning ? 'warning' : session ? 'connected' : 'disconnected'} trailing={trailing}>
    {text}{!isTauri() ? ' · ブラウザプレビュー' : ''}
  </StatusBar>
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
  return <Typography aria-label={`アプリのバージョン ${version}`} color="textSecondary" noWrap sx={{ flexShrink: 0 }} variant="caption">v{version}</Typography>
}

function SettingsView({ autoInstallAllowed, colorPreference, onColorPreferenceChange, onShowShortcuts }: ColorPreferenceProps & { autoInstallAllowed: boolean; onShowShortcuts: () => void }) {
  const { session } = useConnection()
  return <Box>
    <Box sx={{ pb: 2.5 }}>
      <Typography component="h1" variant="h1">設定</Typography>
      <Typography color="textSecondary" sx={{ mt: 0.5 }} variant="body2">GitLabへの接続、表示、この端末に保存するデータを管理します。</Typography>
    </Box>
    <SettingsSection description="接続先とアクセス方法" id="settings-connection" title="GitLab接続"><ConnectionView /></SettingsSection>
    <SettingsSection description="この端末での配色" id="settings-display" title="表示">
      <ToggleButtonGroup aria-label="配色" exclusive onChange={(_, value: ColorPreference | null) => { if (value && value !== colorPreference) onColorPreferenceChange(value) }} size="small" value={colorPreference}>
        <ToggleButton value="system">システムに合わせる</ToggleButton>
        <ToggleButton value="light">ライト</ToggleButton>
        <ToggleButton value="dark">ダーク</ToggleButton>
      </ToggleButtonGroup>
    </SettingsSection>
    <SettingsSection description="表示中のデータの自動取得とデスクトップ通知" id="settings-workspace" title="自動取得と通知"><WorkspaceSettings /></SettingsSection>
    <SettingsSection description="バージョンと更新の確認" id="settings-update" title="アプリの更新"><UpdatePanel autoInstallAllowed={autoInstallAllowed} /></SettingsSection>
    <SettingsSection description="一覧の移動やレビューをキーボードで" id="settings-shortcuts" title="キーボードショートカット">
      <Stack spacing={1} sx={{ alignItems: 'flex-start' }}>
        <Typography color="textSecondary" variant="body2">文字の入力中以外は ? キーでも一覧を開けます。</Typography>
        <Button onClick={onShowShortcuts} variant="outlined">ショートカット一覧を表示</Button>
      </Stack>
    </SettingsSection>
    <SettingsSection description="この端末に保存するMR情報と未送信コメント" id="settings-data" title="保存データ"><CacheSettings sessionId={session?.id ?? null} /></SettingsSection>
  </Box>
}

function CacheSettings({ sessionId }: { sessionId: string | null }) {
  const [status, setStatus] = useState<string | null>(null)
  const [discarding, setDiscarding] = useState(false)
  const confirm = useConfirm()
  const clear = async () => {
    if (!sessionId) return
    try { await clearGitLabCache(sessionId); setStatus('アカウントのキャッシュを削除しました。') } catch (error) { setStatus(error instanceof Error ? error.message : 'キャッシュを削除できませんでした。') }
  }
  const discardInputs = async () => {
    if (!await confirm({ confirmLabel: '破棄する', destructive: true, message: 'この端末に保存した未送信コメントがすべて削除されます。元に戻せません。', title: '未送信コメントをすべて破棄しますか？' })) return
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
  return <Stack spacing={1.5}>
    <Dialog aria-labelledby="discard-inputs-title" open={discarding}><DialogTitle id="discard-inputs-title">未送信コメントを破棄中</DialogTitle><DialogContent><Typography variant="body2">保存待ちと削除が完了するまでお待ちください。</Typography></DialogContent></Dialog>
    <Typography color="textSecondary" variant="body2">未送信コメントはGitLabのレビュー下書きとは別に管理します。キャッシュを削除しても未送信コメントと送信結果の確認記録は残ります。</Typography>
    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
      <Button disabled={!sessionId} onClick={() => void clear()} variant="outlined">キャッシュを削除</Button>
      <Button color="error" disabled={discarding} onClick={() => void discardInputs()} variant="outlined">未送信コメントをすべて破棄</Button>
    </Stack>
    {status ? <Typography color="textSecondary" role="status" variant="caption">{status}</Typography> : null}
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
    if (lookup.loading) return <MergeRequestSkeleton />
    const failure = describeMergeRequestFailure(lookup.error)
    return <PaneEmpty description={failure.description} title={failure.title}>
      <Stack direction="row" spacing={1}>
        {failure.retry ? <Button onClick={lookup.refresh} variant="outlined">再試行</Button> : null}
        <Button onClick={onBack} startIcon={<ArrowBackRoundedIcon />}>{backLabel}</Button>
      </Stack>
    </PaneEmpty>
  }
  return <MergeRequestDetail initialMergeRequest={mergeRequest} backLabel={backLabel} key={`${mergeRequest.projectId}:${mergeRequest.iid}`} onBack={onBack} onOpenProject={() => onOpenProject(mergeRequest.projectPath ?? undefined)} onTabChange={onTabChange} tab={tab} />
}

/** Why an MR could not be shown, in the reader's terms; GitLab's own message is kept for anything else. */
function describeMergeRequestFailure(error: GitLabCommandError | null): { title: string; description: string; retry: boolean } {
  switch (error?.code) {
    case 'AUTH_REQUIRED': return { description: 'GitLabに再接続すると、このMRを開けます。', retry: false, title: '再認証が必要です' }
    case 'FORBIDDEN': return { description: 'このMRを見る権限がありません。プロジェクトのメンバーか確認してください。', retry: true, title: '権限がありません' }
    case 'NOT_FOUND': return { description: 'MRが削除されたか、URLが正しくない可能性があります。', retry: true, title: 'MRが見つかりません' }
    case 'NETWORK':
    case 'TIMEOUT': return { description: '接続を確認してから再試行してください。', retry: true, title: 'GitLabに接続できません' }
    case undefined: return { description: '検索から開き直してください。', retry: true, title: 'このMRを表示できませんでした' }
    default: return { description: error?.message ?? '', retry: true, title: 'このMRを読み込めませんでした' }
  }
}

/** Placeholder with the shape of the MR detail header, so the detail does not jump in. */
function MergeRequestSkeleton() {
  const bar = (width: number | string, height = 12) => <Box sx={{ bgcolor: 'action.hover', borderRadius: 1, height, width }} />
  return <Box aria-live="polite" role="status" sx={{ ...delayedRevealSx, borderBottom: 1, borderColor: 'divider', px: { md: 3, xs: 2 }, pb: 1.5, pt: 1.5 }}>
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minHeight: 32 }}>
      <Typography color="textSecondary" variant="caption">MRを読み込み中…</Typography>
    </Stack>
    <Stack spacing={1.5} sx={{ mt: 1 }}>
      {bar('60%', 22)}
      {bar('45%')}
      {bar('30%')}
    </Stack>
  </Box>
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

/** `userId` decides only where a location without a route starts. */
function readClientLocation(hasSession: boolean, hash = window.location.hash, userId?: string): { raw: string; route: ClientRoute; params: Record<string, string> } {
  const raw = hash.replace(/^#/u, '')
  const start = hubTabLocation(readHubTabOrder()[0], userId)
  if (!raw.startsWith('client')) return hasSession
    ? { ...start, raw }
    : { params: {}, raw, route: 'settings' }
  const [path, search] = raw.split('?')
  const routeValue = path.split('/')[1]
  let params = Object.fromEntries(new URLSearchParams(search ?? '').entries())
  // The former pinned list became the sidebar's pinned tabs; its links show the history.
  // The former pinned list and history are covered by the sidebar's tabs; their links start the MR list.
  let route: ClientRoute | null = routeValue === 'projects' || routeValue === 'mrs' || routeValue === 'branches' || routeValue === 'settings' || routeValue === 'todos' ? routeValue : null
  if (routeValue === 'mr' && params.projectId && params.iid) {
    // Older links opened a full-page detail; show it over the list the MR list starts with.
    route = start.route
    params = { ...start.params, mr: `${params.projectId}-${params.iid}` }
  }
  if (!route) {
    route = hasSession ? start.route : 'settings'
    params = hasSession ? start.params : {}
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

/** Composers, toolbars, menus and forms handle Esc themselves. `data-composer` marks a composer's whole region. */
function isInsideControlGroup(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-composer], [role="toolbar"], [role="menu"], [role="menubar"], [role="listbox"], form') !== null
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select, [role="combobox"], [contenteditable="true"]') !== null)
}
