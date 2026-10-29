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
import Tooltip from '@mui/material/Tooltip'
import type { ReactNode } from 'react'

import type { MessageKey } from '../i18n/i18n'
import { useT } from '../i18n/useT'
import type { MarkdownFormat } from '../lib/markdownFormat'
import { Row } from './Row'

const tools: { format: MarkdownFormat; icon: ReactNode; label: MessageKey; shortcut?: string }[] = [
  { format: 'heading', icon: <TitleRoundedIcon />, label: 'common.markdownToolbar.heading' },
  { format: 'bold', icon: <FormatBoldRoundedIcon />, label: 'common.markdownToolbar.bold', shortcut: 'Ctrl+B' },
  { format: 'italic', icon: <FormatItalicRoundedIcon />, label: 'common.markdownToolbar.italic', shortcut: 'Ctrl+I' },
  { format: 'strikethrough', icon: <StrikethroughSRoundedIcon />, label: 'common.markdownToolbar.strikethrough', shortcut: 'Ctrl+Shift+X' },
  { format: 'quote', icon: <FormatQuoteRoundedIcon />, label: 'common.markdownToolbar.quote' },
  { format: 'code', icon: <CodeRoundedIcon />, label: 'common.markdownToolbar.code' },
  { format: 'link', icon: <LinkRoundedIcon />, label: 'common.markdownToolbar.link' },
  { format: 'bulletList', icon: <FormatListBulletedRoundedIcon />, label: 'common.markdownToolbar.bulletList' },
  { format: 'numberedList', icon: <FormatListNumberedRoundedIcon />, label: 'common.markdownToolbar.numberedList' },
  { format: 'taskList', icon: <ChecklistRoundedIcon />, label: 'common.markdownToolbar.taskList' },
  { format: 'table', icon: <GridOnRoundedIcon />, label: 'common.markdownToolbar.table' },
]

/** GitLab-style formatting buttons for a Markdown textarea. */
export function MarkdownToolbar({ disabled = false, onFormat }: { disabled?: boolean; onFormat: (format: MarkdownFormat) => void }) {
  const t = useT()
  return (
    <Row aria-label={t('common.markdownToolbar.label')} role="toolbar" sx={{ columnGap: 0.25, flexWrap: 'wrap', rowGap: 0.5 }}>
      {tools.map((tool) => (
        <Tooltip key={tool.format} title={tool.shortcut ? t('common.markdownToolbar.withShortcut', { label: t(tool.label), shortcut: tool.shortcut }) : t(tool.label)}>
          <span>
            <IconButton
              aria-label={t('common.markdownToolbar.insert', { label: t(tool.label) })}
              disabled={disabled}
              onClick={() => onFormat(tool.format)}
              // Keep the textarea's selection while clicking.
              onMouseDown={(event) => event.preventDefault()}
              size="small"
            >{tool.icon}</IconButton>
          </span>
        </Tooltip>
      ))}
    </Row>
  )
}
