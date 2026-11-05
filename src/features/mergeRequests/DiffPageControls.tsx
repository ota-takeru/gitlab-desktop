import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'

import { Row } from '../../components/Row'
import { useT } from '../../i18n/useT'

export function PageControls({ offset, pageSize, total, onNext, onPrevious }: { offset: number; pageSize: number; total: number; onNext: () => void; onPrevious: () => void }) {
  const t = useT()
  if (total <= pageSize && offset === 0) return null
  const end = Math.min(total, offset + pageSize)
  const previous = offset
  const remaining = Math.max(0, total - end)
  return <Row aria-label={t('review.diff.page.label')} spacing={1} sx={{ flexWrap: 'wrap', px: 1.5, py: 1 }}>
    <Typography color="textSecondary" sx={{ mr: 'auto' }} variant="caption">{remaining > 0 ? t('review.diff.page.rangeRemaining', { start: String(offset + 1), end: String(end), total: String(total), remaining: String(remaining) }) : t('review.diff.page.range', { start: String(offset + 1), end: String(end), total: String(total) })}</Typography>
    <Button aria-label={t('review.diff.page.previousLines', { count: String(pageSize) })} disabled={previous === 0} onClick={onPrevious} size="small">{t('review.diff.page.previous')}</Button>
    <Button aria-label={t('review.diff.page.nextLines', { count: String(pageSize) })} disabled={remaining === 0} onClick={onNext} size="small">{t('review.diff.page.next')}</Button>
  </Row>
}
