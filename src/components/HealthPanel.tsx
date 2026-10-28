import CheckCircleOutlineRoundedIcon from '@mui/icons-material/CheckCircleOutlineRounded'
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded'
import MemoryOutlinedIcon from '@mui/icons-material/MemoryOutlined'
import ScheduleRoundedIcon from '@mui/icons-material/ScheduleRounded'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Divider from '@mui/material/Divider'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useState } from 'react'

import { translate } from '../i18n/i18n'
import { useT } from '../i18n/useT'
import { getRuntimeInfo, isTauri } from '../lib/runtime'
import type { RuntimeHealthState } from '../types/runtime'
import { StatusPill, type StatusTone } from './StatusPill'

function statusCopy(state: RuntimeHealthState, inTauri: boolean) {
  if (state.status === 'pending') {
    return {
      label: translate('common.health.pending.label'),
      tone: 'info' as StatusTone,
      message: translate('common.health.pending.message'),
    }
  }
  if (state.status === 'success') {
    return {
      label: translate('common.health.success.label'),
      tone: 'success' as StatusTone,
      message: translate('common.health.success.message'),
    }
  }
  if (state.status === 'error') {
    return {
      label: translate('common.health.error.label'),
      tone: 'error' as StatusTone,
      message: state.message ?? translate('common.health.error.message'),
    }
  }
  return {
    label: inTauri ? translate('common.health.idle.label') : translate('common.health.browserPreview'),
    tone: inTauri ? ('default' as StatusTone) : ('warning' as StatusTone),
    message: inTauri
      ? translate('common.health.idle.message')
      : translate('common.health.idle.previewMessage'),
  }
}

export function HealthPanel() {
  const t = useT()
  const inTauri = isTauri()
  const [state, setState] = useState<RuntimeHealthState>({ status: 'idle' })
  const copy = statusCopy(state, inTauri)

  const handleCheck = async () => {
    if (!isTauri()) {
      setState({
        status: 'error',
        message: t('common.health.previewCommandUnavailable'),
      })
      return
    }

    setState({ status: 'pending' })
    try {
      const info = await getRuntimeInfo()
      setState({ status: 'success', info })
    } catch (error) {
      const message = error instanceof Error ? error.message : t('common.health.commandFailed')
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
                  {t('common.health.title')}
                </Typography>
                <Typography color="textSecondary" variant="body2">
                  {t('common.health.description')}
                </Typography>
              </Stack>
            </Stack>
            <StatusPill label={inTauri ? t('common.health.tauriDesktop') : t('common.health.browserPreview')} tone={inTauri ? 'info' : 'warning'} />
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
              spacing={1}
              sx={{ alignItems: 'center' }}
            >
              {state.status === 'success' ? (
                <CheckCircleOutlineRoundedIcon color="success" fontSize="small" />
              ) : state.status === 'error' ? (
                <ErrorOutlineRoundedIcon color="error" fontSize="small" />
              ) : (
                <ScheduleRoundedIcon color={state.status === 'pending' ? 'info' : 'disabled'} fontSize="small" />
              )}
              <Stack spacing={0.25}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Typography sx={{ fontWeight: 700 }} variant="body2">
                    Rust runtime
                  </Typography>
                  <StatusPill label={copy.label} tone={copy.tone} />
                </Stack>
                <Typography color="textSecondary" variant="caption">
                  {copy.message}
                </Typography>
              </Stack>
            </Stack>
            <Button
              disabled={state.status === 'pending'}
              onClick={() => void handleCheck()}
              startIcon={state.status === 'pending' ? <ScheduleRoundedIcon /> : <MemoryOutlinedIcon />}
              variant="contained"
            >
              {state.status === 'pending' ? t('common.health.checking') : t('common.health.check')}
            </Button>
          </Stack>

          {state.info ? (
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              divider={<Divider flexItem orientation="vertical" />}
              spacing={{ xs: 1, sm: 3 }}
              sx={{ bgcolor: 'action.hover', borderRadius: 2, p: 1.5 }}
            >
              <RuntimeValue label={t('common.health.appVersion')} value={state.info.appVersion} />
              <RuntimeValue label={t('common.health.os')} value={state.info.os} />
              <RuntimeValue label={t('common.health.architecture')} value={state.info.arch} />
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
      <Typography color="textSecondary" variant="caption">
        {label}
      </Typography>
      <Typography sx={{ fontFamily: 'code.fontFamily', fontWeight: 700 }} variant="body2">
        {value}
      </Typography>
    </Stack>
  )
}
