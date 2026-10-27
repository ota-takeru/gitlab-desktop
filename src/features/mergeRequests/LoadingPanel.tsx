import Typography from '@mui/material/Typography'
import { delayedRevealSx } from '../../components/paneSx'

/** A status line while a tab loads, shown after a short delay so fast loads do not flash. */
export function LoadingPanel({ label }: { label: string }) { return <Typography color="textSecondary" role="status" sx={{ ...delayedRevealSx, py: 2 }} variant="body2">{label}</Typography> }
