import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded'
import KeyboardArrowUpRoundedIcon from '@mui/icons-material/KeyboardArrowUpRounded'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'

import { useT } from '../../i18n/useT'
import { Row } from '../../components/Row'

/** The arrows stay as small as the caption beside them, in a 24px target. */
const stepSx = { fontSize: 16, height: 24, width: 24, '--edge-inset': '4px' }

/** Compact previous/next unresolved thread control, usable at any width (also with P / N). */
export function UnresolvedThreadStepper({ count, onStep }: { count: number; onStep: (direction: 1 | -1) => void }) {
  const t = useT()
  return (
    <Row aria-label={t('review.unresolved.navigate')} role="group" sx={{ flexShrink: 0 }}>
      <Typography color="textSecondary" noWrap sx={{ pr: 0.25 }} variant="caption">{t('review.unresolved.stepperCount', { count })}</Typography>
      <Tooltip title={t('review.unresolved.previousTooltip')}><IconButton aria-label={t('review.unresolved.previous')} aria-keyshortcuts="P" onClick={() => onStep(-1)} sx={stepSx}><KeyboardArrowUpRoundedIcon fontSize="inherit" /></IconButton></Tooltip>
      <Tooltip title={t('review.unresolved.nextTooltip')}><IconButton aria-label={t('review.unresolved.next')} aria-keyshortcuts="N" onClick={() => onStep(1)} sx={stepSx}><KeyboardArrowDownRoundedIcon fontSize="inherit" /></IconButton></Tooltip>
    </Row>
  )
}
