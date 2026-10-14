import ChecklistRoundedIcon from '@mui/icons-material/ChecklistRounded'
import CodeRoundedIcon from '@mui/icons-material/CodeRounded'
import FormatBoldRoundedIcon from '@mui/icons-material/FormatBoldRounded'
import FormatItalicRoundedIcon from '@mui/icons-material/FormatItalicRounded'
import FormatListBulletedRoundedIcon from '@mui/icons-material/FormatListBulletedRounded'
import FormatListNumberedRoundedIcon from '@mui/icons-material/FormatListNumberedRounded'
import FormatQuoteRoundedIcon from '@mui/icons-material/FormatQuoteRounded'
import GridOnRoundedIcon from '@mui/icons-material/GridOnRounded'
import LinkRoundedIcon from '@mui/icons-material/LinkRounded'
import StrikethroughSRoundedIcon from '@mui/icons-material/StrikethroughSRounded'
import TitleRoundedIcon from '@mui/icons-material/TitleRounded'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import type { ReactNode } from 'react'

import type { MarkdownFormat } from '../lib/markdownFormat'

const tools: { format: MarkdownFormat; icon: ReactNode; label: string; shortcut?: string }[] = [
  { format: 'heading', icon: <TitleRoundedIcon />, label: '見出し' },
  { format: 'bold', icon: <FormatBoldRoundedIcon />, label: '太字', shortcut: 'Ctrl+B' },
  { format: 'italic', icon: <FormatItalicRoundedIcon />, label: '斜体', shortcut: 'Ctrl+I' },
  { format: 'strikethrough', icon: <StrikethroughSRoundedIcon />, label: '取り消し線', shortcut: 'Ctrl+Shift+X' },
  { format: 'quote', icon: <FormatQuoteRoundedIcon />, label: '引用' },
  { format: 'code', icon: <CodeRoundedIcon />, label: 'コード' },
  { format: 'link', icon: <LinkRoundedIcon />, label: 'リンク' },
  { format: 'bulletList', icon: <FormatListBulletedRoundedIcon />, label: '箇条書き' },
  { format: 'numberedList', icon: <FormatListNumberedRoundedIcon />, label: '番号付きリスト' },
  { format: 'taskList', icon: <ChecklistRoundedIcon />, label: 'タスクリスト' },
  { format: 'table', icon: <GridOnRoundedIcon />, label: '表' },
]

/** GitLab-style formatting buttons for a Markdown textarea. */
export function MarkdownToolbar({ disabled = false, onFormat }: { disabled?: boolean; onFormat: (format: MarkdownFormat) => void }) {
  return (
    <Stack aria-label="Markdownの書式" direction="row" role="toolbar" sx={{ flexWrap: 'wrap', gap: 0.25 }}>
      {tools.map((tool) => (
        <Tooltip key={tool.format} title={tool.shortcut ? `${tool.label}（${tool.shortcut}）` : tool.label}>
          <span>
            <IconButton
              aria-label={`${tool.label}を挿入`}
              disabled={disabled}
              onClick={() => onFormat(tool.format)}
              // Keep the textarea's selection while clicking.
              onMouseDown={(event) => event.preventDefault()}
              size="small"
            >{tool.icon}</IconButton>
          </span>
        </Tooltip>
      ))}
    </Stack>
  )
}
