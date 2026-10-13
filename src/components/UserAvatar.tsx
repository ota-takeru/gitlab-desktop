import Box from '@mui/material/Box'
import { alpha } from '@mui/material/styles'

// Status colors (error, warning) are left out so an initial never reads as a state.
const tones = ['primary', 'secondary', 'success', 'info'] as const

/**
 * User avatar. Shows the GitLab image when `src` is available and otherwise an
 * initial whose tone is derived from the user id, so a person keeps one color.
 * The tone is a quiet tint behind the letter rather than a solid disc.
 */
export function UserAvatar({ id, name, size = 28, src }: { id: string; name: string; size?: number; src?: string | null }) {
  if (src) {
    return <Box alt="" aria-hidden component="img" src={src} sx={{ bgcolor: 'action.hover', borderRadius: '50%', display: 'block', flexShrink: 0, height: size, objectFit: 'cover', width: size }} />
  }
  const tone = tones[Array.from(id).reduce((sum, char) => sum + char.charCodeAt(0), 0) % tones.length]
  const initial = Array.from(name.trim() || '?')[0].toUpperCase()
  return (
    <Box aria-hidden sx={{ alignItems: 'center', bgcolor: (theme) => alpha(theme.palette[tone].main, 0.2), borderRadius: '50%', color: `${tone}.main`, display: 'flex', flexShrink: 0, fontSize: Math.round(size * 0.45), fontWeight: 600, height: size, justifyContent: 'center', userSelect: 'none', width: size }}>
      {initial}
    </Box>
  )
}
