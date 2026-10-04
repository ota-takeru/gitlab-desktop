import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlined'
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlined'
import PendingOutlinedIcon from '@mui/icons-material/PendingOutlined'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Divider from '@mui/material/Divider'
import Dialog from '@mui/material/Dialog'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useCallback, useEffect, useRef, useState } from 'react'

import { checkAppUpdate, installAppUpdate, type AppUpdate } from '../lib/updater'
import { isTauri } from '../lib/runtime'
import { flushComposerBuffers } from '../features/mergeRequests/useComposerBuffer'
import { StatusPill, type StatusTone } from './StatusPill'

export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
export const AUTO_INSTALL_DELAY_MS = 2 * 60 * 1000

type UpdateState =
  | { status: 'pending' }
  | { status: 'available'; update: AppUpdate }
  | { status: 'current' }
  | { status: 'unconfigured' }
  | { status: 'error'; message: string }
  | { status: 'installing' }
  | { status: 'installed' }

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '更新を確認できませんでした。'
}

export interface UpdatePanelProps {
  /** The owning screen should opt in only when no unsaved work is present. */
  autoInstallAllowed?: boolean
  compact?: boolean
}

export function UpdatePanel({ autoInstallAllowed = false, compact = false }: UpdatePanelProps) {
  const inTauri = isTauri()
  const [state, setState] = useState<UpdateState>({ status: inTauri ? 'pending' : 'unconfigured' })
  const [autoInstallDeferred, setAutoInstallDeferred] = useState(false)
  const [autoInstallSeconds, setAutoInstallSeconds] = useState<number | null>(null)
  const busy = useRef(false)

  const check = useCallback(async () => {
    if (document.visibilityState !== 'visible' || busy.current) {
      return
    }
    busy.current = true
    setState((current) => (current.status === 'installing' ? current : { status: 'pending' }))
    try {
      const result = await checkAppUpdate()
      if (!result.configured) {
        setState({ status: 'unconfigured' })
      } else if (result.version) {
        setAutoInstallDeferred(false)
        setState({ status: 'available', update: result })
      } else {
        setState({ status: 'current' })
      }
    } catch (error) {
      setState({ status: 'error', message: errorMessage(error) })
    } finally {
      busy.current = false
    }
  }, [])

  useEffect(() => {
    if (!inTauri) {
      return undefined
    }
    const initialCheck = window.setTimeout(() => void check(), 0)
    const interval = window.setInterval(() => void check(), UPDATE_CHECK_INTERVAL_MS)
    return () => {
      window.clearTimeout(initialCheck)
      window.clearInterval(interval)
    }
  }, [check, inTauri])

  const install = useCallback(async () => {
    if (busy.current || !autoInstallAllowed) return
    busy.current = true
    setState({ status: 'installing' })
    try {
      if (!await flushComposerBuffers()) {
        throw new Error('未送信コメントを端末に保存できないため、更新を中止しました。入力は保持されています。')
      }
      await installAppUpdate()
      setState({ status: 'installed' })
    } catch (error) {
      setState({ status: 'error', message: errorMessage(error) })
    } finally {
      busy.current = false
    }
  }, [autoInstallAllowed])

  const availableVersion = state.status === 'available' ? state.update.version : null

  useEffect(() => {
    if (
      !inTauri ||
      !autoInstallAllowed ||
      autoInstallDeferred ||
      state.status !== 'available' ||
      !availableVersion
    ) {
      return undefined
    }

    let deadline = Date.now() + AUTO_INSTALL_DELAY_MS
    const resetDeadline = () => { deadline = Date.now() + AUTO_INSTALL_DELAY_MS }
    window.addEventListener('pointerdown', resetDeadline, { passive: true })
    window.addEventListener('keydown', resetDeadline)
    window.addEventListener('scroll', resetDeadline, { passive: true, capture: true })
    document.addEventListener('visibilitychange', resetDeadline)
    const initialCountdown = window.setTimeout(() => {
      setAutoInstallSeconds(Math.ceil(AUTO_INSTALL_DELAY_MS / 1000))
    }, 0)
    const countdown = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
      setAutoInstallSeconds(remaining)
      if (remaining === 0 && document.visibilityState === 'visible') {
        window.clearInterval(countdown)
        void install()
      }
    }, 1000)

    return () => {
      window.clearTimeout(initialCountdown)
      window.clearInterval(countdown)
      window.removeEventListener('pointerdown', resetDeadline)
      window.removeEventListener('keydown', resetDeadline)
      window.removeEventListener('scroll', resetDeadline, true)
      document.removeEventListener('visibilitychange', resetDeadline)
    }
  }, [autoInstallAllowed, autoInstallDeferred, availableVersion, inTauri, install, state.status])

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
        <Typography color="text.secondary" variant="body2">
          インストールが完了するまで操作できません。完了後にアプリを再起動します。
        </Typography>
      </DialogContent>
    </Dialog>
  ) : null

  if (compact) {
    return <>
      <Card component="section" aria-label="アプリの更新"><CardContent sx={{ p: 1.25, '&:last-child': { pb: 1.25 } }}>
        <Stack spacing={0.5}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
            <StatusPill label={copy.label} tone={copy.tone} />
            <Typography aria-live="polite" sx={{ flex: 1 }} variant="caption">{copy.title}{availableVersion ? ` · v${availableVersion}` : ''}</Typography>
            {inTauri ? <Button disabled={isBusy} onClick={() => void check()} size="small">更新を確認</Button> : null}
            {state.status === 'available' ? <>
              <Button disabled={isBusy || !autoInstallAllowed} onClick={() => void install()} size="small" variant="contained">更新をインストール</Button>
              {autoInstallAllowed && !autoInstallDeferred ? <Button onClick={() => { setAutoInstallDeferred(true); setAutoInstallSeconds(null) }} size="small">後で</Button> : null}
            </> : null}
          </Stack>
          {state.status === 'error' || state.status === 'installing' ? <Typography color="text.secondary" variant="caption">{copy.message}</Typography> : null}
          {state.status === 'available' ? <Typography color="text.secondary" variant="caption">{!autoInstallAllowed ? '入力の保存または破棄と送信処理の確認が済むまで、更新を待機しています。' : autoInstallDeferred ? '自動更新を延期しました。' : `操作のない安全な状態が${formatCountdown(autoInstallSeconds ?? 120)}続くと自動で更新します。`}</Typography> : null}
        </Stack>
      </CardContent></Card>
      {installingDialog}
    </>
  }

  return <>
    <Card component="section" aria-labelledby="app-update-title">
      <CardContent sx={{ p: { xs: 2.5, md: 3 } }}>
        <Stack spacing={2.25}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={2}
            sx={{ alignItems: { sm: 'flex-start' }, justifyContent: 'space-between' }}
          >
            <Stack direction="row" spacing={1.5}>
              <DownloadOutlinedIcon sx={{ color: 'primary.main', mt: 0.25 }} />
              <Stack spacing={0.5}>
                <Typography component="h2" id="app-update-title" variant="h2">
                  アプリの更新
                </Typography>
                <Typography color="text.secondary" variant="body2">
                  署名済みの GitHub リリースを起動時と一定間隔で確認します。
                </Typography>
              </Stack>
            </Stack>
            <StatusPill label={copy.label} tone={copy.tone} />
          </Stack>

          <Divider />

          {inTauri ? <Button disabled={isBusy} onClick={() => void check()} size="small" sx={{ alignSelf: 'flex-start' }}>更新を確認</Button> : null}

          <Stack
            aria-atomic="true"
            aria-live="polite"
            direction={{ xs: 'column', md: 'row' }}
            spacing={2}
            sx={{ alignItems: { md: 'center' }, justifyContent: 'space-between' }}
          >
            <Stack direction="row" spacing={1.25} sx={{ alignItems: 'flex-start' }}>
              {copy.icon}
              <Stack spacing={0.25}>
                <Typography sx={{ fontWeight: 700 }} variant="body2">
                  {copy.title}
                </Typography>
                <Typography color="text.secondary" variant="caption">
                  {copy.message}
                </Typography>
                {state.status === 'available' ? (
                  <Typography sx={{ fontWeight: 700, mt: 0.5 }} variant="body2">
                    v{state.update.version}
                  </Typography>
                ) : null}
              </Stack>
            </Stack>

            {state.status === 'available' ? (
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}>
                <Button disabled={isBusy || !autoInstallAllowed} onClick={() => void install()} startIcon={<DownloadOutlinedIcon />} variant="contained">
                  更新をインストール
                </Button>
                {autoInstallAllowed && !autoInstallDeferred ? (
                  <Button
                    disabled={isBusy}
                    onClick={() => {
                      setAutoInstallDeferred(true)
                      setAutoInstallSeconds(null)
                    }}
                    size="small"
                  >
                    後で
                  </Button>
                ) : null}
              </Stack>
            ) : null}
          </Stack>

          {state.status === 'available' && autoInstallAllowed ? (
            <Typography color="text.secondary" variant="caption">
              {autoInstallDeferred
                ? '自動更新を延期しました。必要なときに手動でインストールできます。'
                : autoInstallSeconds === null
                  ? '安全な状態が続けば、2分後に自動で更新をインストールします。'
                  : `安全な状態が続けば、${formatCountdown(autoInstallSeconds)}後に自動で更新します。`}
            </Typography>
          ) : null}
          {state.status === 'available' && !autoInstallAllowed ? (
            <Typography color="text.secondary" variant="caption">入力の保存または破棄と送信処理の確認が済むまで、更新を待機しています。</Typography>
          ) : null}
        </Stack>
      </CardContent>
    </Card>
    {installingDialog}
  </>
}

function formatCountdown(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return minutes > 0 ? `${minutes}分${remainder.toString().padStart(2, '0')}秒 ` : `${remainder}秒 `
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
      icon: <PendingOutlinedIcon color="warning" fontSize="small" />,
    }
  }
  if (state.status === 'pending') {
    return {
      label: '確認中',
      tone: 'info',
      title: '更新を確認中',
      message: 'GitHub の署名済みリリースを確認しています。',
      icon: <PendingOutlinedIcon color="info" fontSize="small" />,
    }
  }
  if (state.status === 'available') {
    return {
      label: '更新あり',
      tone: 'success',
      title: '新しいバージョンがあります',
      message: state.update.notes?.trim() || '準備ができたときに更新をインストールできます。',
      icon: <DownloadOutlinedIcon color="success" fontSize="small" />,
    }
  }
  if (state.status === 'installing') {
    return {
      label: 'インストール中',
      tone: 'info',
      title: '更新をインストール中',
      message: '完了するまでアプリを閉じないでください。',
      icon: <PendingOutlinedIcon color="info" fontSize="small" />,
    }
  }
  if (state.status === 'installed') {
    return {
      label: '完了',
      tone: 'success',
      title: '更新を適用しました',
      message: 'アプリが再起動すると新しいバージョンが有効になります。',
      icon: <CheckCircleOutlineIcon color="success" fontSize="small" />,
    }
  }
  if (state.status === 'current') {
    return {
      label: '最新',
      tone: 'success',
      title: '最新バージョンです',
      message: '署名を確認できる公開リリースだけを対象にしています。',
      icon: <CheckCircleOutlineIcon color="success" fontSize="small" />,
    }
  }
  if (state.status === 'error') {
    return {
      label: '確認エラー',
      tone: 'error',
      title: '更新を確認できませんでした',
      message: state.message,
      icon: <ErrorOutlineIcon color="error" fontSize="small" />,
    }
  }
  return {
    label: '未設定',
    tone: 'default',
    title: '更新は未設定です',
    message: '配布版では署名鍵と公開リポジトリを設定して確認します。',
    icon: <PendingOutlinedIcon color="disabled" fontSize="small" />,
  }
}
