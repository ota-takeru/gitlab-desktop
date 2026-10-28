import ArticleOutlinedIcon from '@mui/icons-material/ArticleOutlined'
import Button from '@mui/material/Button'
import ListItemText from '@mui/material/ListItemText'
import ListSubheader from '@mui/material/ListSubheader'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import { useId, useState } from 'react'

import { useT } from '../../i18n/useT'
import type { CommentTemplatesQuery, DescriptionTemplatesQuery, TextTemplate } from '../../types/gitlab'
import { useConnection } from '../connections/connectionContext'
import { useGitLabQuery } from '../shared/useGitLabQuery'

const SCOPES: TextTemplate['scope'][] = ['project', 'group', 'user']

/** A toolbar button listing GitLab's templates; the chosen one's text goes to `onInsert`. Read only once opened. */
export function TemplateMenu({ disabled = false, onInsert, query }: {
  disabled?: boolean
  onInsert: (content: string) => void
  query: DescriptionTemplatesQuery | CommentTemplatesQuery
}) {
  const t = useT()
  const { session } = useConnection()
  const menuId = useId()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [opened, setOpened] = useState(false)
  const templates = useGitLabQuery(session?.id ?? null, opened ? query : null)
  const items = templates.data ?? []
  const grouped = query.kind === 'commentTemplates'

  const choose = (template: TextTemplate) => {
    setAnchor(null)
    onInsert(template.content)
  }
  const status = templates.error
    ? t('review.template.failed', { error: templates.error.message })
    : templates.loading && !templates.data ? t('review.template.loading')
      : items.length === 0 ? t('review.template.empty') : null

  return <>
    <Button
      aria-controls={anchor ? menuId : undefined}
      aria-haspopup="menu"
      disabled={disabled}
      onClick={(event) => { setOpened(true); setAnchor(event.currentTarget) }}
      size="small"
      startIcon={<ArticleOutlinedIcon />}
    >
      {t('review.template.button')}
    </Button>
    <Menu anchorEl={anchor} id={menuId} onClose={() => setAnchor(null)} open={Boolean(anchor)} slotProps={{ paper: { sx: { maxHeight: 360, maxWidth: 360 } } }}>
      {status ? <MenuItem disabled>{status}</MenuItem> : null}
      {grouped
        ? SCOPES.flatMap((scope) => {
          const inScope = items.filter((template) => template.scope === scope)
          return inScope.length ? [
            <ListSubheader key={scope}>{t(`review.template.scope.${scope}`)}</ListSubheader>,
            ...inScope.map((template) => <TemplateItem key={template.id} onClick={() => choose(template)} template={template} />),
          ] : []
        })
        : items.map((template) => <TemplateItem key={template.id} onClick={() => choose(template)} template={template} />)}
      {templates.snapshot?.completeness === 'truncated' ? <MenuItem disabled>{t('review.template.truncated')}</MenuItem> : null}
    </Menu>
  </>
}

function TemplateItem({ onClick, template }: { onClick: () => void; template: TextTemplate }) {
  return <MenuItem onClick={onClick}>
    <ListItemText primary={template.name} secondary={template.content.split('\n').find((line) => line.trim()) ?? ''} slotProps={{ secondary: { noWrap: true } }} />
  </MenuItem>
}
