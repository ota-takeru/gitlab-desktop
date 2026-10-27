import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import Snackbar from '@mui/material/Snackbar'
import { useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'

import { FeedbackContext, type Choice, type ConfirmOptions, type Feedback, type NotifyOptions } from './feedbackContext'

export type { Choice, ChoiceOptions, ConfirmOptions, NotifyOptions } from './feedbackContext'

/** Changes the confirmations asked inside it, for example to add a warning that applies to the whole area. */
export function ConfirmScope({ children, confirm }: { children: ReactNode; confirm: Feedback['confirm'] }) {
  const { choose, notify } = useContext(FeedbackContext)
  const value = useMemo(() => ({ choose, confirm, notify }), [choose, confirm, notify])
  return <FeedbackContext.Provider value={value}>{children}</FeedbackContext.Provider>
}

/** One themed confirmation dialog and one notice at a time for the whole client. */
export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<ConfirmOptions & { alternativeLabel?: string } | null>(null)
  const resolveRef = useRef<((value: Choice) => void) | null>(null)
  const [notice, setNotice] = useState<(NotifyOptions & { key: number }) | null>(null)

  const choose = useCallback((options: ConfirmOptions & { alternativeLabel?: string }) => new Promise<Choice>((resolve) => {
    resolveRef.current?.('cancel')
    resolveRef.current = resolve
    setPending(options)
  }), [])
  const confirm = useCallback(async (options: ConfirmOptions) => await choose(options) === 'confirm', [choose])
  const settle = (value: Choice) => {
    resolveRef.current?.(value)
    resolveRef.current = null
    setPending(null)
  }
  const notify = useCallback((options: NotifyOptions) => setNotice({ ...options, key: Date.now() }), [])
  const value = useMemo(() => ({ choose, confirm, notify }), [choose, confirm, notify])
  const closeNotice = () => setNotice(null)

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <Dialog aria-labelledby="confirm-dialog-title" maxWidth="xs" onClose={() => settle('cancel')} open={pending !== null} fullWidth>
        <DialogTitle id="confirm-dialog-title">{pending?.title}</DialogTitle>
        {pending?.message ? <DialogContent><DialogContentText component="div" variant="body2">{pending.message}</DialogContentText></DialogContent> : null}
        <DialogActions>
          <Button autoFocus onClick={() => settle('cancel')}>{pending?.cancelLabel ?? 'キャンセル'}</Button>
          {/* The alternative gives something up, so it reads as a warning beside the main action. */}
          {pending?.alternativeLabel ? <Button color="error" onClick={() => settle('alternative')}>{pending.alternativeLabel}</Button> : null}
          <Button color={pending?.destructive ? 'error' : 'primary'} onClick={() => settle('confirm')} variant="contained">{pending?.confirmLabel}</Button>
        </DialogActions>
      </Dialog>
      <Snackbar anchorOrigin={{ horizontal: 'center', vertical: 'bottom' }} autoHideDuration={notice?.onAction ? 8000 : 4000} key={notice?.key} onClose={(_, reason) => { if (reason !== 'clickaway') closeNotice() }} open={notice !== null}>
        <Alert
          action={notice?.onAction ? <Button color="inherit" onClick={() => { notice.onAction?.(); closeNotice() }} size="small">{notice.actionLabel ?? '元に戻す'}</Button> : undefined}
          onClose={closeNotice}
          severity={notice?.severity ?? 'info'}
          variant="outlined"
        >
          {notice?.message}
        </Alert>
      </Snackbar>
    </FeedbackContext.Provider>
  )
}
