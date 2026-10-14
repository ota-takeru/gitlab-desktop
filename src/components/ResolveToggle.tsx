import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import RadioButtonUncheckedRoundedIcon from '@mui/icons-material/RadioButtonUncheckedRounded'
import Button from '@mui/material/Button'
import Tooltip from '@mui/material/Tooltip'

/**
 * A thread's resolution state and the control that changes it, in one button:
 * 「未解決」 resolves the thread, 「解決済み」 reopens it. The accessible name is
 * the action the button takes; the visible text is the current state.
 */
export function ResolveToggle({ dense = false, disabled = false, onToggle, pending = false, resolved }: { dense?: boolean; disabled?: boolean; onToggle: (resolve: boolean) => void; pending?: boolean; resolved: boolean }) {
  const action = resolved ? '未解決に戻す' : '解決する'
  return <Tooltip describeChild title={resolved ? '未解決に戻す' : '解決済みにする'}>
    <span>
      <Button
        aria-busy={pending || undefined}
        aria-label={action}
        color={resolved ? 'success' : 'inherit'}
        disabled={disabled || pending}
        onClick={() => onToggle(!resolved)}
        size="small"
        startIcon={resolved ? <CheckCircleRoundedIcon /> : <RadioButtonUncheckedRoundedIcon />}
        sx={{ borderColor: resolved ? undefined : 'surface.borderStrong', color: resolved ? undefined : 'text.secondary', flexShrink: 0, whiteSpace: 'nowrap', ...(dense ? denseSx : {}) }}
        variant="outlined"
      >{pending ? '更新中…' : resolved ? '解決済み' : '未解決'}</Button>
    </span>
  </Tooltip>
}

/** For one-line bars between code lines: a 24px control with a caption-sized label. */
const denseSx = { '&.MuiButton-sizeSmall': { fontSize: 'caption.fontSize', minHeight: 24, px: 1, py: 0 }, '& .MuiButton-startIcon': { mr: 0.5 }, '& .MuiButton-startIcon > *:nth-of-type(1)': { fontSize: 14 } } as const
