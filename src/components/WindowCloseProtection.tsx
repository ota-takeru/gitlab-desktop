import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import { useEffect, useState } from 'react'

import { useT } from '../i18n/useT'
import { isTauri } from '../lib/runtime'
import { ensureBeforeUnloadProtection, initializeWindowCloseProtection, queueWindowCloseGuard, setCloseDialogs, setLatestWindowUnsafe } from '../lib/windowSafety'
import { useRetainedComposerUnsafe } from '../features/mergeRequests/useComposerBuffer'
import { useAutoUpdateAllowed, useAutoUpdateSafety, useUnsafeSources } from '../features/shared/autoUpdateSafetyContext'
import { useChoose, useConfirm, useNotify } from './feedbackContext'
import { Row } from './Row'
import { withItems } from './withItems'

type ProtectionStatus = 'starting' | 'ready' | 'failed'

/**
 * Keeps the native close interception synchronized with unsaved work.
 *
 * The native event listener is deliberately owned by windowSafety.ts and is
 * never removed when this component's subtree is unmounted. That keeps close
 * handling alive across error-boundary recovery and React StrictMode cycles.
 */
export function WindowCloseProtection() {
  const t = useT()
  const allowed = useAutoUpdateAllowed()
  const retainedComposerUnsafe = useRetainedComposerUnsafe()
  const { setUnsafe: setRetainedComposerUnsafe } = useAutoUpdateSafety('retained-composers', { persistOnUnmount: true })
  const unsafe = !allowed || retainedComposerUnsafe
  const sources = useUnsafeSources()

  useEffect(() => {
    setRetainedComposerUnsafe(retainedComposerUnsafe)
  }, [retainedComposerUnsafe, setRetainedComposerUnsafe])

  // While mounted, closing asks with the app's own dialogs instead of the browser's.
  const confirm = useConfirm()
  const choose = useChoose()
  const notify = useNotify()
  useEffect(() => setCloseDialogs({
    choose: ({ items, message, ...options }) => choose({ ...options, message: withItems(message, items) }),
    confirm: ({ items, message, ...options }) => confirm({ ...options, message: withItems(message, items) }),
    notify: (message) => notify({ message, severity: 'error' }),
  }), [choose, confirm, notify])

  const [status, setStatus] = useState<ProtectionStatus>('starting')
  const [retry, setRetry] = useState(0)

  // Keep the event callback current before effects and IPC writes run.
  setLatestWindowUnsafe(unsafe, sources)

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
    <Row spacing={1} sx={{ justifyContent: 'space-between' }}>
      <Typography variant="body2">{t('common.closeProtection.enableFailed')}</Typography>
      <Button onClick={() => { setStatus('starting'); setRetry((current) => current + 1) }} size="small" variant="outlined">{t('common.closeProtection.retry')}</Button>
    </Row>
  </Alert>
}
