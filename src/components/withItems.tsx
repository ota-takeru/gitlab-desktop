import Box from '@mui/material/Box'
import Link from '@mui/material/Link'
import Typography from '@mui/material/Typography'

import { translate } from '../i18n/i18n'
import type { CloseItem, UnsentTarget } from '../lib/windowSafety'

/**
 * The places with unsent work under the question: the screen on one line, what in it is not sent below it.
 * With `onOpen`, each screen is a link that goes there.
 */
export function withItems(message: string | undefined, items: CloseItem[] | undefined, onOpen?: (target: UnsentTarget) => void) {
  if (!items?.length) return message
  return <>
    {message}
    <Box aria-label={translate('common.closeProtection.unsentScreens')} component="ul" sx={{ m: 0, mt: 1, pl: 2.5 }}>
      {items.map(({ detail, name, target }) => <Box component="li" key={name}>
        {onOpen && target
          ? <Link component="button" noWrap onClick={() => onOpen(target)} sx={{ display: 'block', maxWidth: '100%', textAlign: 'left' }} title={name} type="button" underline="hover" variant="body2">{name}</Link>
          : <Typography noWrap title={name} variant="body2">{name}</Typography>}
        {detail ? <Typography color="textSecondary" component="div" variant="caption">{detail}</Typography> : null}
      </Box>)}
    </Box>
  </>
}
