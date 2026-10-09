import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import { useEffect, useRef, useState } from 'react'
import { queryGitLab } from '../../lib/gitlab'
import { parseMergeRequestUrl } from '../../lib/mergeRequestUrl'
import { useConnection } from '../connections/ConnectionProvider'
import type { MrRef } from '../shared/personalWorkspace'

export function OpenMergeRequestDialog({ open, onClose, onOpen }: { open: boolean; onClose: () => void; onOpen: (ref: MrRef) => void }) {
  const { session } = useConnection()
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    const invalidate = () => { active.current = false }
    globalThis.addEventListener('gitlab-explicit-logout', invalidate)
    globalThis.addEventListener('gitlab-account-replaced', invalidate)
    return () => { active.current = false; globalThis.removeEventListener('gitlab-explicit-logout', invalidate); globalThis.removeEventListener('gitlab-account-replaced', invalidate) }
  }, [])
  const submit = async () => {
    if (!session || pending) return
    setPending(true); setError('')
    try {
      const parsed = parseMergeRequestUrl(url, session.instanceUrl)
      const result = await queryGitLab({ sessionId: session.id, mode: 'network', query: { kind: 'project', path: parsed.path } })
      if (!result?.data.id) throw new Error('プロジェクトを取得できませんでした。')
      if (active.current) { onOpen({ projectId: result.data.id, iid: parsed.iid }); onClose(); setUrl('') }
    } catch (caught) { if (active.current) setError(caught instanceof Error ? caught.message : 'MRを開けませんでした。') }
    finally { if (active.current) setPending(false) }
  }
  return <Dialog aria-labelledby="open-mr-title" fullWidth maxWidth="sm" open={open} onClose={pending ? undefined : onClose}>
    <DialogTitle id="open-mr-title">MR URLから開く</DialogTitle>
    <DialogContent><Stack component="form" id="open-mr-form" onSubmit={(event) => { event.preventDefault(); void submit() }} spacing={1} sx={{ pt: 0.5 }}>
      <TextField autoFocus disabled={pending} fullWidth label="MR URL" onChange={(event) => setUrl(event.target.value)} placeholder={`${session?.instanceUrl ?? 'https://gitlab.example'}/group/project/-/merge_requests/123`} value={url} />
      {error ? <Alert severity="error">{error}</Alert> : null}
    </Stack></DialogContent>
    <DialogActions><Button disabled={pending} onClick={onClose}>閉じる</Button><Button disabled={!session || !url.trim() || pending} form="open-mr-form" type="submit" variant="contained">{pending ? '確認中…' : '開く'}</Button></DialogActions>
  </Dialog>
}
