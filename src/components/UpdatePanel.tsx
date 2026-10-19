import CheckCircleOutlineRoundedIcon from '@mui/icons-material/CheckCircleOutlineRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined'
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded'
import ScheduleRoundedIcon from '@mui/icons-material/ScheduleRounded'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Dialog from '@mui/material/Dialog'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useEffect, useState, useSyncExternalStore } from 'react'

import { checkAppUpdate, downloadAppUpdate, installAppUpdate, type AppUpdate } from '../lib/updater'
import { getRuntimeInfo, isTauri } from '../lib/runtime'
import { flushComposerBuffers } from '../features/mergeRequests/useComposerBuffer'
import { RelativeTime } from './RelativeTime'
import { StatusPill, type StatusTone } from './StatusPill'
import { UpdateNavButton } from './UpdateNavButton'

export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000
/** Returning to the window checks again once the last check is this old. */
const RETURN_CHECK_AFTER_MS = 15 * 60 * 1000
/** A dismissed check failure stays out of the footer this long, also across launches. */
const CHECK_ERROR_DISMISS_MS = 24 * 60 * 60 * 1000
const CHECK_ERROR_DISMISSED_KEY = 'gitlab-desktop:update-check-error-dismissed-at'
const WAITING_FOR_SAFE_STATE = '入力の保存または破棄と送信処理の確認が済むと更新できます。'

type UpdateState =
  | { status: 'pending' }
  // The signed package downloads in the background; installing stays the user's action.
  | { status: 'available'; update: AppUpdate; download: 'pending' | 'ready' | 'failed'; downloadError?: string }
  | { status: 'current' }
  | { status: 'unconfigured' }
  | { status: 'error'; message: string; source: 'check' | 'install' }
  | { status: 'installing' }
  | { status: 'installed' }

interface UpdateSnapshot {
  state: UpdateState
  lastCheckedAt: number | null
}

/** Tauri rejects with plain `{ code, message }` objects, not Error instances. */
function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message
  const message = error && typeof error === 'object' ? (error as { message?: unknown }).message : error
  return typeof message === 'string' && message ? message : fallback
}

// One updater state for the whole window: the footer and the settings show the
// same check, and a second mounted panel never starts a second check or install.
const listeners = new Set<() => void>()
let snapshot: UpdateSnapshot = initialSnapshot()
let subscribers = 0
let generation = 0
let busy = false
let downloading = false
let initialCheck: ReturnType<typeof globalThis.setTimeout> | undefined
let periodicCheck: ReturnType<typeof globalThis.setInterval> | undefined

function initialSnapshot(): UpdateSnapshot {
  return { lastCheckedAt: null, state: { status: isTauri() ? 'pending' : 'unconfigured' } }
}

function publish(next: Partial<UpdateSnapshot>) {
  snapshot = { ...snapshot, ...next }
  listeners.forEach((listener) => listener())
}

function resetUpdater() {
  generation += 1
  busy = false
  downloading = false
  snapshot = initialSnapshot()
}

function subscribeToUpdates(listener: () => void) {
  listeners.add(listener)
  subscribers += 1
  if (subscribers === 1) {
    resetUpdater()
    if (isTauri()) {
      initialCheck = globalThis.setTimeout(() => void checkForUpdate(), 0)
      periodicCheck = globalThis.setInterval(() => void checkForUpdate(), UPDATE_CHECK_INTERVAL_MS)
      document.addEventListener('visibilitychange', checkOnReturn)
      globalThis.addEventListener('focus', checkOnReturn)
    }
  }
  return () => {
    listeners.delete(listener)
    subscribers -= 1
    if (subscribers === 0) {
      globalThis.clearTimeout(initialCheck)
      globalThis.clearInterval(periodicCheck)
      document.removeEventListener('visibilitychange', checkOnReturn)
      globalThis.removeEventListener('focus', checkOnReturn)
      resetUpdater()
    }
  }
}

function getUpdateSnapshot() { return snapshot }

/**
 * The first check is skipped while the window is hidden; without this the status would stay 「確認中」.
 * Coming back to the window also finds a release published meanwhile, without waiting for the interval.
 */
function checkOnReturn() {
  if (snapshot.lastCheckedAt === null ? snapshot.state.status === 'pending' : Date.now() - snapshot.lastCheckedAt >= RETURN_CHECK_AFTER_MS) void checkForUpdate()
}

async function checkForUpdate() {
  // Rust runs one updater operation at a time; a running download is not interrupted.
  if (!isTauri() || document.visibilityState !== 'visible' || busy || downloading) return
  busy = true
  const current = generation
  let download = false
  // A found update stays offered while it is checked again, so its install button does not blink.
  const found = snapshot.state.status === 'available' ? snapshot.state : null
  if (snapshot.state.status !== 'installing' && !found) publish({ state: { status: 'pending' } })
  try {
    const result = await checkAppUpdate()
    if (current !== generation) return
    download = Boolean(result.configured && result.version && !result.downloaded)
    publish({
      lastCheckedAt: Date.now(),
      state: !result.configured ? { status: 'unconfigured' } : result.version ? { download: result.downloaded ? 'ready' : 'pending', status: 'available', update: result } : { status: 'current' },
    })
  } catch (error) {
    if (current !== generation) return
    // A failed re-check does not take back an update that was already found.
    publish({ lastCheckedAt: Date.now(), state: found ?? { message: errorMessage(error, '更新を確認できませんでした。'), source: 'check', status: 'error' } })
  } finally {
    if (current === generation) busy = false
  }
  if (download) void downloadUpdate()
}

/** Downloads and verifies the found update in the background; it never installs. */
async function downloadUpdate() {
  if (downloading) return
  downloading = true
  const current = generation
  let failure: string | null = null
  try {
    await downloadAppUpdate()
  } catch (error) {
    failure = errorMessage(error, '更新をダウンロードできませんでした。')
  }
  if (current !== generation) return
  downloading = false
  // An install the user started meanwhile owns the state.
  if (snapshot.state.status !== 'available') return
  publish({ state: failure ? { ...snapshot.state, download: 'failed', downloadError: failure } : { ...snapshot.state, download: 'ready', downloadError: undefined } })
}

/** Only ever called from the user's click: the app never restarts by itself. */
async function installUpdate() {
  if (busy) return
  busy = true
  const current = generation
  publish({ state: { status: 'installing' } })
  try {
    if (!await flushComposerBuffers()) {
      throw new Error('未送信コメントを端末に保存できないため、更新を中止しました。入力は保持されています。')
    }
    await installAppUpdate()
    if (current === generation) publish({ state: { status: 'installed' } })
  } catch (error) {
    if (current === generation) publish({ state: { message: errorMessage(error, '更新をインストールできませんでした。'), source: 'install', status: 'error' } })
  } finally {
    if (current === generation) busy = false
  }
}

function checkErrorDismissedRecently(): boolean {
  try {
    const dismissedAt = Number(globalThis.localStorage?.getItem(CHECK_ERROR_DISMISSED_KEY))
    return Number.isFinite(dismissedAt) && Date.now() - dismissedAt < CHECK_ERROR_DISMISS_MS
  } catch {
    return false
  }
}

function rememberCheckErrorDismissed() {
  try { globalThis.localStorage?.setItem(CHECK_ERROR_DISMISSED_KEY, String(Date.now())) } catch { /* Dismissed for this session only. */ }
}

/**
 * Shows the navigation's install button only while an update is available.
 * The always-mounted footer panel owns the installing dialog.
 */
export function UpdateSidebarButton({ autoInstallAllowed = false, collapsed }: { autoInstallAllowed?: boolean; collapsed: boolean }) {
  const { state } = useSyncExternalStore(subscribeToUpdates, getUpdateSnapshot, getUpdateSnapshot)
  if (state.status !== 'available' || !state.update.version) return null
  return <UpdateNavButton collapsed={collapsed} disabledReason={autoInstallAllowed ? undefined : WAITING_FOR_SAFE_STATE} onClick={() => { if (autoInstallAllowed) void installUpdate() }} version={state.update.version} />
}

export interface UpdatePanelProps {
  /** The owning screen allows installing only when no unsaved work is present. */
  autoInstallAllowed?: boolean
  compact?: boolean
  /** A small indicator for the window's footer: only an available update or a failure shows. */
  notificationOnly?: boolean
}

export function UpdatePanel({ autoInstallAllowed = false, compact = false, notificationOnly = false }: UpdatePanelProps) {
  const inTauri = isTauri()
  const { lastCheckedAt, state } = useSyncExternalStore(subscribeToUpdates, getUpdateSnapshot, getUpdateSnapshot)
  const [dismissedError, setDismissedError] = useState<UpdateState | null>(null)
  const [currentVersion, setCurrentVersion] = useState<string | null>(null)
  const showsVersion = inTauri && !compact && !notificationOnly
  useEffect(() => {
    if (!showsVersion) return undefined
    let active = true
    getRuntimeInfo().then((info) => { if (active && typeof info?.appVersion === 'string') setCurrentVersion(info.appVersion) }).catch(() => undefined)
    return () => { active = false }
  }, [showsVersion])

  const check = () => void checkForUpdate()
  const install = () => { if (autoInstallAllowed) void installUpdate() }
  const availableVersion = state.status === 'available' ? state.update.version : null
  const copy = getCopy(state, inTauri)
  const isBusy = state.status === 'pending' || state.status === 'installing'
  const installingDialog = state.status === 'installing' ? (
    <Dialog
      aria-labelledby="app-update-installing-title"
      open
      sx={{
        '& .MuiDialog-paper': {
          border: 1,
          borderColor: 'divider',
          boxShadow: 8,
        },
      }}
    >
      <DialogTitle id="app-update-installing-title">更新中…完了後再起動</DialogTitle>
      <DialogContent sx={{ pt: 0 }}>
        <Typography color="textSecondary" variant="body2">
          インストールが完了するまで操作できません。完了後にアプリを再起動します。
        </Typography>
      </DialogContent>
    </Dialog>
  ) : null
  const installButton = (size: 'small' | 'medium') => (
    <Tooltip title={autoInstallAllowed ? '入力を端末に保存してから再起動し、更新を適用します。' : WAITING_FOR_SAFE_STATE}>
      <Box component="span" sx={{ flexShrink: 0 }}>
        <Button disabled={isBusy || !autoInstallAllowed} onClick={install} size={size} startIcon={size === 'medium' ? <DownloadOutlinedIcon /> : undefined} sx={size === 'small' ? { '&.MuiButton-sizeSmall': { minHeight: 24, py: 0 } } : undefined} variant={size === 'small' ? 'text' : 'contained'}>
          再起動して更新
        </Button>
      </Box>
    </Tooltip>
  )

  if (notificationOnly) {
    // The footer keeps its height whatever shows here, so the page never shifts.
    const hiddenError = state.status === 'error' && (state === dismissedError || (state.source === 'check' && checkErrorDismissedRecently()))
    const errorNotice = (message: string, onClose: () => void) => <>
      <Stack aria-label="アプリの更新" component="section" direction="row" spacing={0.5} sx={{ alignItems: 'center', minWidth: 0 }}>
        <WarningAmberRoundedIcon color="warning" fontSize="inherit" />
        <Typography color="warning" noWrap role="status" sx={{ minWidth: 0 }} title={message} variant="caption">{message}</Typography>
        <Tooltip title="閉じる">
          <IconButton aria-label="更新の通知を閉じる" onClick={onClose} size="small" sx={{ flexShrink: 0, fontSize: 16, p: 0.5 }}>
            <CloseRoundedIcon fontSize="inherit" />
          </IconButton>
        </Tooltip>
      </Stack>
      {installingDialog}
    </>
    if (state.status === 'available') {
      // A failed background download is a notice; the update stays installable, downloading on install.
      if (state.download === 'failed' && state !== dismissedError) return errorNotice(state.downloadError ?? '更新をダウンロードできませんでした。', () => setDismissedError(state))
      const availableNotice = state.download === 'ready' ? `v${availableVersion} ダウンロード済み ·` : `v${availableVersion} に更新できます`
      return <>
        <Stack aria-label="アプリの更新" component="section" direction="row" spacing={0.5} sx={{ alignItems: 'center', minWidth: 0 }}>
          <Typography color="textSecondary" noWrap sx={{ minWidth: 0 }} title={availableNotice} variant="caption">{availableNotice}</Typography>
          {installButton('small')}
        </Stack>
        {installingDialog}
      </>
    }
    if (state.status === 'error' && !hiddenError) {
      return errorNotice(state.message, () => { setDismissedError(state); if (state.source === 'check') rememberCheckErrorDismissed() })
    }
    return installingDialog
  }

  if (compact) {
    return <>
      <Card component="section" aria-label="アプリの更新"><CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Stack spacing={0.5}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
            <StatusPill label={copy.label} tone={copy.tone} />
            <Typography aria-live="polite" sx={{ flex: 1 }} variant="caption">{copy.title}{availableVersion ? ` · v${availableVersion}` : ''}</Typography>
            {inTauri ? <Button disabled={isBusy} onClick={check} size="small">更新を確認</Button> : null}
            {state.status === 'available' ? installButton('small') : null}
          </Stack>
          {state.status === 'error' || state.status === 'installing' ? <Typography color="textSecondary" variant="caption">{copy.message}</Typography> : null}
          {state.status === 'available' ? <Typography color={state.download === 'failed' ? 'warning' : 'textSecondary'} variant="caption">{downloadStatus(state)}</Typography> : null}
          {state.status === 'available' && !autoInstallAllowed ? <Typography color="textSecondary" variant="caption">{WAITING_FOR_SAFE_STATE}</Typography> : null}
        </Stack>
      </CardContent></Card>
      {installingDialog}
    </>
  }

  // The settings page: its section already carries the heading.
  return <>
    <Stack spacing={1.5}>
      <Stack aria-atomic="true" aria-live="polite" direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
        {copy.icon}
        <Stack spacing={0.25} sx={{ minWidth: 0 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
            <Typography sx={{ fontWeight: 600 }} variant="body2">{copy.title}</Typography>
            <StatusPill label={copy.label} tone={copy.tone} />
          </Stack>
          {state.status === 'available' ? <Typography sx={{ fontWeight: 600 }} variant="body2">v{state.update.version}</Typography> : null}
          {state.status === 'available' ? <Typography color={state.download === 'failed' ? 'warning' : 'textSecondary'} variant="caption">{downloadStatus(state)}</Typography> : null}
          <Typography color="textSecondary" variant="caption">{copy.message}</Typography>
        </Stack>
      </Stack>
      {inTauri ? <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
        <Typography color="textSecondary" variant="caption">現在のバージョン {currentVersion ? `v${currentVersion}` : '—'}</Typography>
        {lastCheckedAt ? <RelativeTime prefix="最終確認" value={new Date(lastCheckedAt).toISOString()} /> : <Typography color="textSecondary" variant="caption">最終確認 未確認</Typography>}
      </Stack> : null}
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
        {inTauri ? <Button disabled={isBusy} onClick={check} variant="outlined">更新を確認</Button> : null}
        {state.status === 'available' ? installButton('medium') : null}
      </Stack>
      {state.status === 'available' && !autoInstallAllowed ? <Typography color="textSecondary" variant="caption">{WAITING_FOR_SAFE_STATE}</Typography> : null}
    </Stack>
    {installingDialog}
  </>
}

function downloadStatus(state: Extract<UpdateState, { status: 'available' }>): string {
  if (state.download === 'ready') return 'ダウンロード済み · 再起動して更新できます'
  if (state.download === 'failed') return state.downloadError ?? '更新をダウンロードできませんでした。'
  return 'バックグラウンドでダウンロード中…（インストールはしません）'
}

function getCopy(state: UpdateState, inTauri: boolean): {
  label: string
  tone: StatusTone
  title: string
  message: string
  icon: React.ReactNode
} {
  if (!inTauri) {
    return {
      label: 'プレビュー',
      tone: 'warning',
      title: 'デスクトップで更新を確認できます',
      message: 'ブラウザプレビューでは更新コマンドを実行しません。',
      icon: <ScheduleRoundedIcon color="warning" fontSize="small" />,
    }
  }
  if (state.status === 'pending') {
    return {
      label: '確認中',
      tone: 'info',
      title: '更新を確認中',
      message: 'GitHub の署名済みリリースを確認しています。',
      icon: <ScheduleRoundedIcon color="info" fontSize="small" />,
    }
  }
  if (state.status === 'available') {
    return {
      label: state.download === 'ready' ? 'ダウンロード済み' : '更新あり',
      tone: 'success',
      title: '新しいバージョンがあります',
      message: state.update.notes?.trim() || '再起動すると新しいバージョンになります。準備ができたときに更新してください。',
      icon: <DownloadOutlinedIcon color="success" fontSize="small" />,
    }
  }
  if (state.status === 'installing') {
    return {
      label: 'インストール中',
      tone: 'info',
      title: '更新をインストール中',
      message: '完了するまでアプリを閉じないでください。',
      icon: <ScheduleRoundedIcon color="info" fontSize="small" />,
    }
  }
  if (state.status === 'installed') {
    return {
      label: '完了',
      tone: 'success',
      title: '更新を適用しました',
      message: 'アプリが再起動すると新しいバージョンが有効になります。',
      icon: <CheckCircleOutlineRoundedIcon color="success" fontSize="small" />,
    }
  }
  if (state.status === 'current') {
    return {
      label: '最新',
      tone: 'success',
      title: '最新バージョンです',
      message: '署名を確認できる公開リリースだけを対象にしています。',
      icon: <CheckCircleOutlineRoundedIcon color="success" fontSize="small" />,
    }
  }
  if (state.status === 'error') {
    return {
      label: state.source === 'install' ? '更新エラー' : '確認エラー',
      tone: 'error',
      title: state.source === 'install' ? '更新をインストールできませんでした' : '更新を確認できませんでした',
      message: state.message,
      icon: <ErrorOutlineRoundedIcon color="error" fontSize="small" />,
    }
  }
  return {
    label: '未設定',
    tone: 'default',
    title: '更新は未設定です',
    message: '配布版では署名鍵と公開リポジトリを設定して確認します。',
    icon: <ScheduleRoundedIcon color="disabled" fontSize="small" />,
  }
}
