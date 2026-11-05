import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import { useMemo, type ReactNode } from 'react'

import { hairline, panelFrame } from '../../components/hairline'
import { ListRow } from '../../components/ListRow'
import { moveListRowFocus } from '../../components/listRowFocus'
import { MergeRequestStateIcon } from '../../components/MergeRequestStateIcon'
import { PaneHeader } from '../../components/Pane'
import { RelativeTime } from '../../components/RelativeTime'
import { Bar, Row } from '../../components/Row'
import { useT } from '../../i18n/useT'
import { parseGitLabPageUrl } from '../../lib/gitlabPageUrl'
import type { MergeRequestsQuery, ProjectLookupQuery, RepositoryCommitsQuery } from '../../types/gitlab'
import type { MrRef } from '../shared/personalWorkspace'
import { useGitLabQuery } from '../shared/useGitLabQuery'
import { CommitRow } from './CommitHistory'
import { ProjectReadmePreview } from './ProjectReadmePreview'

/** How many rows each list beside the README shows; the tabs have the rest. */
const PANEL_ROWS = 5

/**
 * What a project is and what is happening in it: the README in full, with the
 * latest commits and open MRs beside it (above it when narrow), each leading to its tab.
 */
export function ProjectOverview({ instanceUrl, navigation, onOpenCommit, onOpenMergeRequest, onShowHistory, onShowMergeRequests, projectId, projectName, projectUrl, sessionId }: {
  instanceUrl: string
  navigation?: ReactNode
  onOpenCommit?: (sha: string) => void
  onOpenMergeRequest?: (ref: MrRef) => void
  onShowHistory?: () => void
  onShowMergeRequests?: () => void
  projectId: string
  projectName: string
  projectUrl?: string
  sessionId: string
}) {
  const t = useT()
  const projectPage = projectUrl ? parseGitLabPageUrl(projectUrl, instanceUrl) : null
  const projectQuery: ProjectLookupQuery | null = projectPage ? { kind: 'project', path: projectPage.path } : null
  const project = useGitLabQuery(sessionId, projectQuery)
  const commitsQuery = useMemo<RepositoryCommitsQuery>(() => ({ kind: 'repositoryCommits', page: 1, projectId }), [projectId])
  const commits = useGitLabQuery(sessionId, commitsQuery)
  const mergeRequestsQuery = useMemo<MergeRequestsQuery>(() => ({ kind: 'mrs', orderBy: 'updated_at', page: 1, projectId, search: '', sort: 'desc', state: 'opened' }), [projectId])
  const mergeRequests = useGitLabQuery(sessionId, mergeRequestsQuery)
  const description = project.data?.description

  return <Box component="section" sx={{ display: 'flex', flex: 1, flexDirection: 'column', minHeight: 0 }}>
    <PaneHeader navigation={navigation} title={t('project.overview.title', { project: projectName })}>
      {description ? <Typography color="textSecondary" sx={{ overflowWrap: 'anywhere' }} variant="body2">{description}</Typography> : null}
    </PaneHeader>
    <Box sx={{ containerType: 'inline-size', flex: 1, minHeight: 0, overflow: 'auto', px: { xs: 1.5, md: 2 }, py: 2 }}>
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'minmax(0, 1fr)', '@container (min-width: 1200px)': { gridTemplateColumns: 'minmax(0, 1fr) 340px' } }}>
        <Box sx={{ display: 'grid', gap: 2, gridAutoRows: 'min-content', minWidth: 0, '@container (min-width: 1200px)': { alignSelf: 'start', gridColumn: 2, gridRow: 1, position: 'sticky', top: 0 } }}>
          <OverviewPanel actionLabel={t('project.overview.showAll')} empty={t('project.overview.noCommits')} error={commits.error} hasData={Boolean(commits.data)} isEmpty={!commits.data?.length} loading={commits.loading} onAction={onShowHistory} title={t('project.overview.recentCommits')}>
            {commits.data?.slice(0, PANEL_ROWS).map((commit) => <CommitRow commit={commit} key={commit.id} onOpen={() => onOpenCommit?.(commit.id)} />)}
          </OverviewPanel>
          <OverviewPanel actionLabel={t('project.overview.showAll')} empty={t('project.overview.noMergeRequests')} error={mergeRequests.error} hasData={Boolean(mergeRequests.data)} isEmpty={!mergeRequests.data?.length} loading={mergeRequests.loading} onAction={onShowMergeRequests} title={t('project.overview.openMergeRequests')}>
            {mergeRequests.data?.slice(0, PANEL_ROWS).map((mergeRequest) => <ListRow key={mergeRequest.iid} leading={<MergeRequestStateIcon state={mergeRequest.state} />} onOpen={() => onOpenMergeRequest?.({ iid: mergeRequest.iid, projectId: mergeRequest.projectId })}>
              <Typography noWrap sx={{ fontWeight: 600 }} title={mergeRequest.title} variant="body2">{mergeRequest.title}</Typography>
              <Row spacing={1} sx={{ minWidth: 0 }}>
                <Typography color="textSecondary" noWrap sx={{ minWidth: 0 }} variant="caption">!{mergeRequest.iid} · {mergeRequest.author.name}</Typography>
                <RelativeTime value={mergeRequest.updatedAt} />
              </Row>
            </ListRow>)}
          </OverviewPanel>
        </Box>
        <Box sx={{ minWidth: 0, '@container (min-width: 1200px)': { gridColumn: 1, gridRow: 1 } }}>
          <ProjectReadmePreview instanceUrl={instanceUrl} project={{ id: projectId, name: projectName, ...(projectUrl ? { webUrl: projectUrl } : {}) }} sessionId={sessionId} />
        </Box>
      </Box>
    </Box>
  </Box>
}

function OverviewPanel({ actionLabel, children, empty, error, hasData, isEmpty, loading, onAction, title }: { actionLabel: string; children: ReactNode; empty: string; error: Error | null; hasData: boolean; isEmpty: boolean; loading: boolean; onAction?: () => void; title: string }) {
  const t = useT()
  return <Box aria-label={title} component="section" sx={{ ...panelFrame(), borderRadius: 2, overflow: 'hidden' }}>
    <Bar spacing={1} sx={{ ...hairline('bottom'), minHeight: 40, px: 1.5 }}>
      <Typography component="h2" sx={{ fontWeight: 600, mr: 'auto' }} variant="body2">{title}</Typography>
      {onAction ? <Button onClick={onAction} size="dense">{actionLabel}</Button> : null}
    </Bar>
    {loading && !hasData ? <Typography color="textSecondary" component="div" sx={{ px: 1.5, py: 1 }} variant="caption">{t('project.readme.loading')}</Typography> : null}
    {error ? <Alert severity="warning" sx={{ m: 1 }}>{t('project.overview.failed', { message: error.message })}</Alert> : null}
    {hasData && isEmpty ? <Typography color="textSecondary" component="div" sx={{ px: 1.5, py: 1 }} variant="caption">{empty}</Typography> : null}
    {hasData && !isEmpty ? <Box component="ul" onKeyDown={moveListRowFocus} sx={{ m: 0, p: 0 }}>{children}</Box> : null}
  </Box>
}
