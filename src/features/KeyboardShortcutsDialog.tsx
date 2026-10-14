import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Typography from '@mui/material/Typography'
import { Fragment } from 'react'

import { Kbd } from '../components/Pane'

const shortcutGroups: Array<{ title: string; items: Array<{ keys: string[][]; label: string }> }> = [
  {
    items: [
      { keys: [['J'], ['K']], label: '次/前のMR' },
      { keys: [['↑'], ['↓']], label: '行移動' },
      { keys: [['Enter']], label: '開く' },
      { keys: [['Space']], label: 'MRの概要をプレビュー' },
      { keys: [['/']], label: '一覧内検索' },
      { keys: [['Ctrl', 'K']], label: 'すべてのMRを検索' },
      { keys: [['Ctrl', 'O']], label: 'URLから開く' },
      { keys: [['Esc']], label: '一覧へ戻る' },
      { keys: [['Alt', '←'], ['Alt', '→']], label: '戻る/進む（MR一覧のタブ上ではタブを並べ替え）' },
      { keys: [['Alt', '↑'], ['Alt', '↓']], label: 'サイドバーのMRタブを並べ替え（タブ上で）' },
    ],
    title: '一覧と移動',
  },
  {
    items: [
      { keys: [['N'], ['P']], label: '次/前の未解決スレッド' },
      { keys: [[']'], ['[']], label: '次/前のファイル' },
      { keys: [['Shift', '↑'], ['Shift', '↓']], label: '行の「+」で複数行を選択（Enterでコメント）' },
      { keys: [['Ctrl', 'Enter']], label: 'レビューに追加' },
      { keys: [['Ctrl', 'Shift', 'Enter']], label: '今すぐ投稿' },
    ],
    title: 'MRのレビュー',
  },
  {
    items: [{ keys: [['?']], label: 'この一覧を表示' }],
    title: 'ヘルプ',
  },
]

/** Every keyboard shortcut of the client in one place; `?` opens it outside text input. */
export function KeyboardShortcutsDialog({ onClose, open }: { onClose: () => void; open: boolean }) {
  return (
    <Dialog aria-labelledby="keyboard-shortcuts-title" fullWidth maxWidth="xs" onClose={onClose} open={open}>
      <DialogTitle id="keyboard-shortcuts-title">キーボードショートカット</DialogTitle>
      <DialogContent dividers>
        {shortcutGroups.map((group) => (
          <Box component="section" key={group.title} sx={{ '& + &': { mt: 2 } }}>
            <Typography color="textSecondary" component="h3" sx={{ mb: 1 }} variant="overline">{group.title}</Typography>
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
                  <Typography component="dd" sx={{ alignSelf: 'center', m: 0 }} variant="body2">{item.label}</Typography>
                </Fragment>
              ))}
            </Box>
          </Box>
        ))}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>閉じる</Button>
      </DialogActions>
    </Dialog>
  )
}
