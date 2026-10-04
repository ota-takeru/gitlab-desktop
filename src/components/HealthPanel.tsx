import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlined'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlined'
import MemoryOutlinedIcon from '@mui/icons-material/MemoryOutlined'
import PendingOutlinedIcon from '@mui/icons-material/PendingOutlined'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Divider from '@mui/material/Divider'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useState } from 'react'

import { getRuntimeInfo, isTauri } from '../lib/runtime'
import type { RuntimeHealthState } from '../types/runtime'
import { StatusPill, type StatusTone } from './StatusPill'

function statusCopy(state: RuntimeHealthState, inTauri: boolean) {
  if (state.status === 'pending') {
    return {
      label: '確認中',
      tone: 'info' as StatusTone,
      message: 'Rust バックエンドから実行環境を取得しています。',
    }
  }
  if (state.status === 'success') {
    return {
      label: '接続済み',
      tone: 'success' as StatusTone,
      message: 'デスクトップブリッジが応答しました。',
    }
  }
  if (state.status === 'error') {
    return {
      label: '接続エラー',
      tone: 'error' as StatusTone,
      message: state.message ?? '実行環境を確認できませんでした。',
    }
  }
  return {
    label: inTauri ? '未確認' : 'ブラウザプレビュー',
    tone: inTauri ? ('default' as StatusTone) : ('warning' as StatusTone),
    message: inTauri
      ? 'GitLab 接続の前に、Rust 側の実行環境を確認できます。'
      : 'ブラウザプレビューでは Rust コマンドを呼び出せません。デスクトップ起動時に確認できます。',
  }
}

export function HealthPanel() {
  const inTauri = isTauri()
  const [state, setState] = useState<RuntimeHealthState>({ status: 'idle' })
  const copy = statusCopy(state, inTauri)

  const handleCheck = async () => {
    if (!isTauri()) {
      setState({
        status: 'error',
        message: 'ブラウザプレビューのため Rust コマンドを実行できません。',
      })
      return
    }

    setState({ status: 'pending' })
    try {
      const info = await getRuntimeInfo()
      setState({ status: 'success', info })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Rust コマンドが失敗しました。'
      setState({ status: 'error', message })
    }
  }

  return (
    <Card component="section" aria-labelledby="runtime-health-title">
      <CardContent sx={{ p: { xs: 2.5, md: 3 } }}>
        <Stack spacing={2.5}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={2}
            sx={{
              alignItems: { sm: 'flex-start' },
              justifyContent: 'space-between',
            }}
          >
            <Stack direction="row" spacing={1.5}>
              <MemoryOutlinedIcon sx={{ color: 'primary.main', mt: 0.25 }} />
              <Stack spacing={0.5}>
                <Typography component="h2" id="runtime-health-title" variant="h2">
                  開発環境のヘルスチェック
                </Typography>
                <Typography color="text.secondary" variant="body2">
                  GitLab のデータへ接続する前に、このアプリと Rust ブリッジの状態を確認します。
                </Typography>
              </Stack>
            </Stack>
            <StatusPill label={inTauri ? 'Tauri デスクトップ' : 'ブラウザプレビュー'} tone={inTauri ? 'info' : 'warning'} />
          </Stack>

          <Divider />

          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={2}
            sx={{
              alignItems: { md: 'center' },
              justifyContent: 'space-between',
            }}
          >
            <Stack
              aria-atomic="true"
              aria-live="polite"
              direction="row"
              spacing={1.25}
              sx={{ alignItems: 'center' }}
            >
              {state.status === 'success' ? (
                <CheckCircleOutlineIcon color="success" fontSize="small" />
              ) : state.status === 'error' ? (
                <ErrorOutlineIcon color="error" fontSize="small" />
              ) : (
                <PendingOutlinedIcon color={state.status === 'pending' ? 'info' : 'disabled'} fontSize="small" />
              )}
              <Stack spacing={0.25}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Typography sx={{ fontWeight: 700 }} variant="body2">
                    Rust runtime
                  </Typography>
                  <StatusPill label={copy.label} tone={copy.tone} />
                </Stack>
                <Typography color="text.secondary" variant="caption">
                  {copy.message}
                </Typography>
              </Stack>
            </Stack>
            <Button
              disabled={state.status === 'pending'}
              onClick={() => void handleCheck()}
              startIcon={state.status === 'pending' ? <PendingOutlinedIcon /> : <MemoryOutlinedIcon />}
              variant="contained"
            >
              {state.status === 'pending' ? '確認中…' : 'Rust 環境を確認'}
            </Button>
          </Stack>

          {state.info ? (
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              divider={<Divider flexItem orientation="vertical" />}
              spacing={{ xs: 1, sm: 3 }}
              sx={{ bgcolor: 'action.hover', borderRadius: 1.5, p: 1.5 }}
            >
              <RuntimeValue label="App version" value={state.info.appVersion} />
              <RuntimeValue label="OS" value={state.info.os} />
              <RuntimeValue label="Architecture" value={state.info.arch} />
            </Stack>
          ) : null}
        </Stack>
      </CardContent>
    </Card>
  )
}

function RuntimeValue({ label, value }: { label: string; value: string }) {
  return (
    <Stack spacing={0.25} sx={{ minWidth: 120 }}>
      <Typography color="text.secondary" variant="caption">
        {label}
      </Typography>
      <Typography sx={{ fontFamily: 'monospace', fontWeight: 700 }} variant="body2">
        {value}
      </Typography>
    </Stack>
  )
}
