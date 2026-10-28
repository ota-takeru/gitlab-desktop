import Alert from '@mui/material/Alert'
import Checkbox from '@mui/material/Checkbox'
import FormControlLabel from '@mui/material/FormControlLabel'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useEffect, useRef, useState } from 'react'
import { useT } from '../../i18n/useT'
import { enableDesktopNotifications } from '../../lib/notifications'
import { usePersonalWorkspace, type WorkspaceSettings as Settings } from '../shared/personalWorkspace'
import { useConnection } from './connectionContext'

export function WorkspaceSettings() {
  const { session } = useConnection()
  const t = useT()
  const workspace = usePersonalWorkspace(session)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    const invalidate = () => { active.current = false }
    globalThis.addEventListener('gitlab-explicit-logout', invalidate)
    globalThis.addEventListener('gitlab-account-replaced', invalidate)
    return () => {
      active.current = false
      globalThis.removeEventListener('gitlab-explicit-logout', invalidate)
      globalThis.removeEventListener('gitlab-account-replaced', invalidate)
    }
  }, [])
  const toggleNotification = async (key: 'notifyComments' | 'notifyTodos', checked: boolean) => {
    if (!checked) { workspace.setSettings({ [key]: false }); return }
    setBusy(true); setError('')
    try {
      const allowed = await enableDesktopNotifications()
      if (!active.current) return
      if (allowed) workspace.setSettings({ [key]: true } as Partial<Settings>)
      else setError(t('settings.workspace.permissionDenied'))
    } catch { setError(t('settings.workspace.enableFailed')) }
    finally { setBusy(false) }
  }
  return <Box><Stack spacing={0.5}>
    <FormControlLabel control={<Checkbox checked={workspace.settings.autoRefresh} disabled={!session} onChange={(_, value) => workspace.setSettings({ autoRefresh: value })} size="small" />} label={t('settings.workspace.autoRefresh')} />
    <Typography color="textSecondary" sx={{ mb: 1, mt: -0.5, pl: 3 }} variant="caption">{t('settings.workspace.autoRefreshHint')}</Typography>
    <FormControlLabel control={<Checkbox checked={workspace.settings.notifyComments} disabled={!session || busy} onChange={(_, value) => void toggleNotification('notifyComments', value)} size="small" />} label={t('settings.workspace.notifyComments')} />
    <FormControlLabel control={<Checkbox checked={workspace.settings.notifyTodos} disabled={!session || busy} onChange={(_, value) => void toggleNotification('notifyTodos', value)} size="small" />} label={t('settings.workspace.notifyTodos')} />
    <Typography color="textSecondary" sx={{ mt: -0.5, pl: 3 }} variant="caption">{t('settings.workspace.notifyHint')}</Typography>
    {error ? <Alert severity="warning">{error}</Alert> : null}
  </Stack></Box>
}
