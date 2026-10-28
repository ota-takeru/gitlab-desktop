import Button from '@mui/material/Button'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'

import { useT } from '../i18n/useT'

interface PagerProps {
  page: number
  hasPrevious: boolean
  hasNext: boolean
  onPrevious: () => void
  onNext: () => void
  disabled?: boolean
  /** Optional summary on the left, for example 「12件取得」. */
  summary?: string
}

/** Server-page navigation shared by list screens. Hidden when there is only one page. */
export function Pager({ page, hasPrevious, hasNext, onPrevious, onNext, disabled = false, summary }: PagerProps) {
  const t = useT()
  if (!hasPrevious && !hasNext && !summary) return null
  return (
    <Stack component="nav" aria-label={t('common.pager.label')} direction="row" spacing={0.5} sx={{ alignItems: 'center', justifyContent: 'flex-end', minHeight: 32 }}>
      {summary ? <Typography color="textSecondary" sx={{ mr: 'auto' }} variant="caption">{summary}</Typography> : null}
      {hasPrevious || hasNext ? <>
        <Button disabled={disabled || !hasPrevious} onClick={onPrevious} size="small">{t('common.pager.previous')}</Button>
        <Typography color="textSecondary" sx={{ minWidth: 48, textAlign: 'center' }} variant="caption">{t('common.pager.page', { page })}</Typography>
        <Button disabled={disabled || !hasNext} onClick={onNext} size="small">{t('common.pager.next')}</Button>
      </> : null}
    </Stack>
  )
}
