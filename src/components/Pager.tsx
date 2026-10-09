import Button from '@mui/material/Button'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'

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
  if (!hasPrevious && !hasNext && !summary) return null
  return (
    <Stack component="nav" aria-label="ページ移動" direction="row" spacing={0.5} sx={{ alignItems: 'center', justifyContent: 'flex-end', minHeight: 32 }}>
      {summary ? <Typography color="text.secondary" sx={{ mr: 'auto' }} variant="caption">{summary}</Typography> : null}
      {hasPrevious || hasNext ? <>
        <Button disabled={disabled || !hasPrevious} onClick={onPrevious} size="small">前へ</Button>
        <Typography color="text.secondary" sx={{ minWidth: 48, textAlign: 'center' }} variant="caption">ページ {page}</Typography>
        <Button disabled={disabled || !hasNext} onClick={onNext} size="small">次へ</Button>
      </> : null}
    </Stack>
  )
}
