import Box from '@mui/material/Box'

const tones = ['primary', 'secondary', 'success', 'info', 'warning', 'error'] as const

/**
 * User avatar. Shows the GitLab image when `src` is available and otherwise an
 * initial whose tone is derived from the user id, so a person keeps one color.
 */
export function UserAvatar({ id, name, size = 28, src }: { id: string; name: string; size?: number; src?: string | null }) {
  if (src) {
    return <Box alt="" aria-hidden component="img" src={src} sx={{ bgcolor: 'action.hover', borderRadius: '50%', display: 'block', flexShrink: 0, height: size, objectFit: 'cover', width: size }} />
  }
  const tone = tones[Array.from(id).reduce((sum, char) => sum + char.charCodeAt(0), 0) % tones.length]
  const initial = Array.from(name.trim() || '?')[0].toUpperCase()
  return (
    <Box aria-hidden sx={{ alignItems: 'center', bgcolor: `${tone}.main`, borderRadius: '50%', color: `${tone}.contrastText`, display: 'flex', flexShrink: 0, fontSize: Math.round(size * 0.45), fontWeight: 600, height: size, justifyContent: 'center', userSelect: 'none', width: size }}>
      {initial}
    </Box>
  )
}
