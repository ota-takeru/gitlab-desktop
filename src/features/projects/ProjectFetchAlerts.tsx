import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'

import { useT } from '../../i18n/useT'

interface ProjectFetchAlertsProps {
  error: Error | null
  /** The text when nothing could be read. */
  failed: string
  hasData: boolean
  onRetry: () => void
  /** The text when older data stays on screen. */
  refreshFailed: string
}

/** A failed read of a project screen: an error when there is nothing to show, a warning over data that stays. */
export function ProjectFetchAlerts({ error, failed, hasData, onRetry, refreshFailed }: ProjectFetchAlertsProps) {
  const t = useT()
  if (!error) return null
  return <Alert action={<Button color="inherit" onClick={onRetry}>{t('project.retry')}</Button>} severity={hasData ? 'warning' : 'error'} sx={{ m: 1.5 }}>{hasData ? refreshFailed : failed}</Alert>
}
