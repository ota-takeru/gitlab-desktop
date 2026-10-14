import Box from '@mui/material/Box'

/**
 * User avatar. Shows the GitLab image when `src` is available and otherwise an
 * initial whose tone is derived from the user id, so a person keeps one color.
 * The tone is a quiet tint behind the letter rather than a solid disc.
 */
export function UserAvatar({ id, name, size = 28, src }: { id: string; name: string; size?: number; src?: string | null }) {
  if (src) {
    return <Box alt="" aria-hidden component="img" src={src} sx={{ bgcolor: 'action.hover', borderRadius: '50%', display: 'block', flexShrink: 0, height: size, objectFit: 'cover', width: size }} />
  }
  const hash = Array.from(id).reduce((sum, char) => sum + char.charCodeAt(0), 0)
  const initial = Array.from(name.trim() || '?')[0].toUpperCase()
  // The letter takes a text size that fits the circle instead of a size computed from it.
  const fontSize = size <= 20 ? 'overline.fontSize' : size <= 28 ? 'caption.fontSize' : 'body2.fontSize'
  return (
    <Box aria-hidden sx={(theme) => {
      // Avatar tones are quiet tints that never read as a state colour.
      const tone = theme.palette.avatar[hash % theme.palette.avatar.length]
      return { alignItems: 'center', bgcolor: tone.background, borderRadius: '50%', color: tone.text, display: 'flex', flexShrink: 0, fontSize, fontWeight: 600, height: size, justifyContent: 'center', userSelect: 'none', width: size }
    }}>
      {initial}
    </Box>
  )
}
