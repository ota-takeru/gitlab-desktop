import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useEffect, useState } from 'react'

import { isTauri } from '../lib/runtime'
import { ensureBeforeUnloadProtection, initializeWindowCloseProtection, queueWindowCloseGuard, setLatestWindowUnsafe } from '../lib/windowSafety'
import { useRetainedComposerUnsafe } from '../features/mergeRequests/useComposerBuffer'
import { useAutoUpdateAllowed, useAutoUpdateSafety } from '../features/shared/AutoUpdateSafety'

type ProtectionStatus = 'starting' | 'ready' | 'failed'

/**
 * Keeps the native close interception synchronized with unsaved work.
 *
 * The native event listener is deliberately owned by windowSafety.ts and is
 * never removed when this component's subtree is unmounted. That keeps close
 * handling alive across error-boundary recovery and React StrictMode cycles.
 */
export function WindowCloseProtection() {
  const allowed = useAutoUpdateAllowed()
  const retainedComposerUnsafe = useRetainedComposerUnsafe()
  const { setUnsafe: setRetainedComposerUnsafe } = useAutoUpdateSafety('retained-composers', { persistOnUnmount: true })
  const unsafe = !allowed || retainedComposerUnsafe

  useEffect(() => {
    setRetainedComposerUnsafe(retainedComposerUnsafe)
  }, [retainedComposerUnsafe, setRetainedComposerUnsafe])

  const [status, setStatus] = useState<ProtectionStatus>('starting')
  const [retry, setRetry] = useState(0)

  // Keep the event callback current before effects and IPC writes run.
  setLatestWindowUnsafe(unsafe)

  useEffect(() => {
    ensureBeforeUnloadProtection()
    if (!isTauri()) return
    let mounted = true
    void initializeWindowCloseProtection().then(() => {
      if (mounted) setStatus('ready')
    }).catch(() => {
      if (mounted) setStatus('failed')
    })
    return () => {
      mounted = false
    }
  }, [retry])

  useEffect(() => {
    if (status !== 'ready' || !isTauri()) return
    let mounted = true
    void queueWindowCloseGuard(unsafe).catch(() => {
      if (mounted) setStatus('failed')
    })
    return () => {
      mounted = false
    }
  }, [status, unsafe])

  if (status !== 'failed' || !isTauri()) return null
  return <Alert role="status" severity="warning">
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
      <Typography variant="body2">終了保護を有効にできませんでした。終了前にもう一度お試しください。</Typography>
      <Button onClick={() => { setStatus('starting'); setRetry((current) => current + 1) }} size="small" variant="outlined">再試行</Button>
    </Stack>
  </Alert>
}
