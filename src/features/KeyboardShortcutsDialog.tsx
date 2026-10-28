import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Typography from '@mui/material/Typography'
import { Fragment, memo } from 'react'

import { Kbd } from '../components/Pane'
import type { MessageKey } from '../i18n/i18n'
import { useT } from '../i18n/useT'

const shortcutGroups: Array<{ title: MessageKey; items: Array<{ keys: string[][]; label: MessageKey }> }> = [
  {
    items: [
      { keys: [['J'], ['K']], label: 'shortcuts.list.nextPrevious' },
      { keys: [['↑'], ['↓']], label: 'shortcuts.list.moveRow' },
      { keys: [['Enter']], label: 'shortcuts.list.open' },
      { keys: [['Space']], label: 'shortcuts.list.preview' },
      { keys: [['/']], label: 'shortcuts.list.filter' },
      { keys: [['Ctrl', 'K']], label: 'shortcuts.list.searchAll' },
      { keys: [['Ctrl', 'O']], label: 'shortcuts.list.openUrl' },
      { keys: [['Esc']], label: 'shortcuts.list.back' },
      { keys: [['Alt', '←'], ['Alt', '→']], label: 'shortcuts.list.history' },
      { keys: [['Alt', '↑'], ['Alt', '↓']], label: 'shortcuts.list.reorderTabs' },
    ],
    title: 'shortcuts.list.title',
  },
  {
    items: [
      { keys: [['N'], ['P']], label: 'shortcuts.review.nextThread' },
      { keys: [['D']], label: 'shortcuts.review.description' },
      { keys: [[']'], ['[']], label: 'shortcuts.review.nextFile' },
      { keys: [['Shift', '↑'], ['Shift', '↓']], label: 'shortcuts.review.selectLines' },
      { keys: [['Ctrl', 'Enter']], label: 'shortcuts.review.addToReview' },
      { keys: [['Ctrl', 'Shift', 'Enter']], label: 'shortcuts.review.postNow' },
    ],
    title: 'shortcuts.review.title',
  },
  {
    items: [{ keys: [['?']], label: 'shortcuts.help.show' }],
    title: 'shortcuts.help.title',
  },
]

/** Every keyboard shortcut of the client in one place; `?` opens it outside text input. */
/** Memoized: the closed dialog would otherwise build its whole list again on every navigation. */
export const KeyboardShortcutsDialog = memo(function KeyboardShortcutsDialog({ onClose, open }: { onClose: () => void; open: boolean }) {
  const t = useT()
  return (
    <Dialog aria-labelledby="keyboard-shortcuts-title" fullWidth maxWidth="xs" onClose={onClose} open={open}>
      <DialogTitle id="keyboard-shortcuts-title">{t('shortcuts.title')}</DialogTitle>
      <DialogContent dividers>
        {shortcutGroups.map((group) => (
          <Box component="section" key={group.title} sx={{ '& + &': { mt: 2 } }}>
            <Typography color="textSecondary" component="h3" sx={{ mb: 1 }} variant="overline">{t(group.title)}</Typography>
            <Box component="dl" sx={{ columnGap: 2, display: 'grid', gridTemplateColumns: 'max-content 1fr', m: 0, rowGap: 1 }}>
              {group.items.map((item) => (
                <Fragment key={item.label}>
                  <Box component="dt" sx={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {item.keys.map((combination, index) => (
                      <Fragment key={combination.join('+')}>
                        {index > 0 ? <Typography color="textSecondary" component="span" variant="caption">/</Typography> : null}
                        {combination.map((key, keyIndex) => (
                          <Fragment key={key}>
                            {keyIndex > 0 ? <Typography color="textSecondary" component="span" variant="caption">+</Typography> : null}
                            <Kbd>{key}</Kbd>
                          </Fragment>
                        ))}
                      </Fragment>
                    ))}
                  </Box>
                  <Typography component="dd" sx={{ alignSelf: 'center', m: 0 }} variant="body2">{t(item.label)}</Typography>
                </Fragment>
              ))}
            </Box>
          </Box>
        ))}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('shortcuts.close')}</Button>
      </DialogActions>
    </Dialog>
  )
})
