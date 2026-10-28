import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import RadioButtonUncheckedRoundedIcon from '@mui/icons-material/RadioButtonUncheckedRounded'
import Button from '@mui/material/Button'
import Tooltip from '@mui/material/Tooltip'

import { useT } from '../i18n/useT'

/**
 * A thread's resolution state and the control that changes it, in one button:
 * 「未解決」 resolves the thread, 「解決済み」 reopens it. The accessible name is
 * the visible state followed by the action the button takes.
 */
export function ResolveToggle({ dense = false, disabled = false, onToggle, pending = false, resolved }: { dense?: boolean; disabled?: boolean; onToggle: (resolve: boolean) => void; pending?: boolean; resolved: boolean }) {
  const t = useT()
  const action = resolved ? t('common.resolve.unresolve') : t('common.resolve.resolve')
  const state = pending ? t('common.resolve.updating') : resolved ? t('common.resolve.resolved') : t('common.resolve.unresolved')
  return <Tooltip describeChild title={resolved ? t('common.resolve.unresolve') : t('common.resolve.markResolved')}>
    <span>
      <Button
        aria-busy={pending || undefined}
        aria-label={t('common.resolve.label', { state, action })}
        color={resolved ? 'success' : 'inherit'}
        disabled={disabled || pending}
        onClick={() => onToggle(!resolved)}
        size="small"
        startIcon={resolved ? <CheckCircleRoundedIcon /> : <RadioButtonUncheckedRoundedIcon />}
        sx={{ borderColor: resolved ? undefined : 'surface.borderStrong', color: resolved ? undefined : 'text.secondary', flexShrink: 0, whiteSpace: 'nowrap', ...(dense ? denseSx : {}) }}
        variant="outlined"
      >{state}</Button>
    </span>
  </Tooltip>
}

/** For one-line bars between code lines: a 24px control with a caption-sized label. */
const denseSx = { '&.MuiButton-sizeSmall': { fontSize: 'caption.fontSize', minHeight: 24, px: 1, py: 0 }, '& .MuiButton-startIcon': { mr: 0.5 }, '& .MuiButton-startIcon > *:nth-of-type(1)': { fontSize: 14 } } as const
