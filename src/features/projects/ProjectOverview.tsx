import ArticleOutlinedIcon from '@mui/icons-material/ArticleOutlined'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import type { ReactNode } from 'react'

import { PaneHeader } from '../../components/Pane'
import { useT } from '../../i18n/useT'
import { ProjectReadmePreview } from './ProjectReadmePreview'

/** A project-owned overview instead of an expandable item in search results.
 * Keep the README panel portable while its final layout is being refined. */
export function ProjectOverview({ instanceUrl, navigation, projectId, projectName, projectUrl, sessionId }: {
  instanceUrl: string
  navigation?: ReactNode
  projectId: string
  projectName: string
  projectUrl?: string
  sessionId: string
}) {
  const t = useT()
  return <Box component="section" sx={{ display: 'flex', flex: 1, flexDirection: 'column', minHeight: 0 }}>
    <PaneHeader navigation={navigation} title={t('project.overview.title', { project: projectName })} />
    <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', px: { xs: 1.5, md: 3 }, py: 2 }}>
      <Box sx={{ maxWidth: 960, mx: 'auto' }}>
        <Box sx={{ alignItems: 'center', display: 'flex', gap: 1, mb: 1.5 }}>
          <ArticleOutlinedIcon fontSize="small" sx={{ color: 'place.projects' }} />
          <Typography component="h2" sx={{ fontWeight: 600 }} variant="subtitle1">{t('project.overview.readme')}</Typography>
        </Box>
        <ProjectReadmePreview instanceUrl={instanceUrl} project={{ id: projectId, name: projectName, ...(projectUrl ? { webUrl: projectUrl } : {}) }} sessionId={sessionId} />
      </Box>
    </Box>
  </Box>
}
