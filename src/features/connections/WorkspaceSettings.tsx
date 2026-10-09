import Alert from '@mui/material/Alert'
import Checkbox from '@mui/material/Checkbox'
import FormControlLabel from '@mui/material/FormControlLabel'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useEffect, useRef, useState } from 'react'
import { enableDesktopNotifications } from '../../lib/notifications'
import { usePersonalWorkspace, type WorkspaceSettings as Settings } from '../shared/personalWorkspace'
import { useConnection } from './ConnectionProvider'

export function WorkspaceSettings() {
  const { session } = useConnection()
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
      else setError('通知の許可が得られませんでした。Windowsの通知設定を確認してください。')
    } catch { setError('通知を有効にできませんでした。デスクトップ版で通知設定を確認してください。') }
    finally { setBusy(false) }
  }
  return <Box><Stack spacing={0.5}>
    <FormControlLabel control={<Checkbox checked={workspace.settings.autoRefresh} disabled={!session} onChange={(_, value) => workspace.setSettings({ autoRefresh: value })} size="small" />} label="表示中のMR・コメント・To-Doを1分ごとに更新" />
    <Typography color="text.secondary" sx={{ mb: 1, mt: -0.5, pl: 3.75 }} variant="caption">入力・編集中、送信中、アプリが非表示の間は自動更新を一時停止します。</Typography>
    <FormControlLabel control={<Checkbox checked={workspace.settings.notifyComments} disabled={!session || busy} onChange={(_, value) => void toggleNotification('notifyComments', value)} size="small" />} label="担当・レビューMRへの新着コメントをデスクトップ通知" />
    <FormControlLabel control={<Checkbox checked={workspace.settings.notifyTodos} disabled={!session || busy} onChange={(_, value) => void toggleNotification('notifyTodos', value)} size="small" />} label="メンション・承認依頼などの新しいTo-Doをデスクトップ通知" />
    <Typography color="text.secondary" sx={{ mt: -0.5, pl: 3.75 }} variant="caption">開いているMRと、担当・レビュー待ちの更新順先頭10件の最新30コメントを確認します。To-Doは先頭ページが対象です。通知にはMRタイトルやコメント本文を含めません。アプリが表示中で自動更新が有効な間に確認します。</Typography>
    {error ? <Alert severity="warning">{error}</Alert> : null}
  </Stack></Box>
}
