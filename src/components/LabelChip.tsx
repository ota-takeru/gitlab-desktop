import Box from '@mui/material/Box'
import Chip, { type ChipProps } from '@mui/material/Chip'

const labelColorPattern = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/iu

/**
 * A GitLab label. Its colour is GitLab data, shown only as a small swatch so
 * the text keeps the theme's contrast in both colour modes; a label without a
 * known colour shows no swatch.
 */
export function LabelChip({ color, name, ...chipProps }: { color?: string | null; name: string } & Omit<ChipProps, 'color' | 'icon' | 'label'>) {
  const swatch = color && labelColorPattern.test(color) ? color : null
  return (
    <Chip
      {...chipProps}
      icon={swatch ? <Box aria-hidden component="span" sx={{ bgcolor: swatch, border: 1, borderColor: 'divider', borderRadius: '50%', flexShrink: 0, height: 10, width: 10 }} /> : undefined}
      label={name}
      size="small"
      variant="outlined"
    />
  )
}
