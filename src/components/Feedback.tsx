import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import Snackbar from '@mui/material/Snackbar'
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'

export interface ConfirmOptions {
  title: string
  message?: ReactNode
  /** Names what happens, e.g. 「破棄する」. Never just 「OK」. */
  confirmLabel: string
  cancelLabel?: string
  destructive?: boolean
}

export interface NotifyOptions {
  message: string
  severity?: 'success' | 'info' | 'warning' | 'error'
  actionLabel?: string
  onAction?: () => void
}

interface Feedback {
  confirm: (options: ConfirmOptions) => Promise<boolean>
  notify: (options: NotifyOptions) => void
}

/**
 * Without the provider (isolated component tests) confirmations fall back to the
 * browser dialog and notices are dropped, so components never depend on it being mounted.
 */
const fallback: Feedback = {
  confirm: async ({ message, title }) => globalThis.confirm(typeof message === 'string' ? `${title}\n${message}` : title),
  notify: () => undefined,
}

const FeedbackContext = createContext<Feedback>(fallback)

export function useConfirm() { return useContext(FeedbackContext).confirm }
export function useNotify() { return useContext(FeedbackContext).notify }

/** Changes the confirmations asked inside it, for example to add a warning that applies to the whole area. */
export function ConfirmScope({ children, confirm }: { children: ReactNode; confirm: Feedback['confirm'] }) {
  const notify = useNotify()
  const value = useMemo(() => ({ confirm, notify }), [confirm, notify])
  return <FeedbackContext.Provider value={value}>{children}</FeedbackContext.Provider>
}

/** One themed confirmation dialog and one notice at a time for the whole client. */
export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<ConfirmOptions | null>(null)
  const resolveRef = useRef<((value: boolean) => void) | null>(null)
  const [notice, setNotice] = useState<(NotifyOptions & { key: number }) | null>(null)

  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => {
    resolveRef.current?.(false)
    resolveRef.current = resolve
    setPending(options)
  }), [])
  const settle = (value: boolean) => {
    resolveRef.current?.(value)
    resolveRef.current = null
    setPending(null)
  }
  const notify = useCallback((options: NotifyOptions) => setNotice({ ...options, key: Date.now() }), [])
  const value = useMemo(() => ({ confirm, notify }), [confirm, notify])
  const closeNotice = () => setNotice(null)

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <Dialog aria-labelledby="confirm-dialog-title" maxWidth="xs" onClose={() => settle(false)} open={pending !== null} fullWidth>
        <DialogTitle id="confirm-dialog-title">{pending?.title}</DialogTitle>
        {pending?.message ? <DialogContent><DialogContentText component="div" variant="body2">{pending.message}</DialogContentText></DialogContent> : null}
        <DialogActions>
          <Button autoFocus onClick={() => settle(false)}>{pending?.cancelLabel ?? 'キャンセル'}</Button>
          <Button color={pending?.destructive ? 'error' : 'primary'} onClick={() => settle(true)} variant="contained">{pending?.confirmLabel}</Button>
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
