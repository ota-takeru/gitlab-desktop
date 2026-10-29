import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Stack from '@mui/material/Stack'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useMemo } from 'react'

import { PaneEmpty, PaneHeader, PaneNavigation, PaneStatus } from '../../components/Pane'
import { useT } from '../../i18n/useT'
import { formatFetchedAt } from '../../lib/format'
import type { GitLabUser, MergeRequest, Project } from '../../types/gitlab'
import { useConnection } from '../connections/connectionContext'
import { MergeRequestList } from '../mergeRequests/MergeRequestList'
import { ProjectView } from '../projects/ProjectView'
import { GitLabUserAvatar } from '../shared/GitLabUserAvatar'
import type { MrRef } from '../shared/personalWorkspace'
import { useGitLabQuery } from '../shared/useGitLabQuery'

export type UserTab = 'mrs' | 'projects'

/** The same name-over-tabs header used for a project's lists. */
export function UserNavigation({ onTabChange, sessionId, status, tab, user }: { onTabChange: (tab: UserTab) => void; sessionId?: string; status?: string; tab: UserTab; user: GitLabUser }) {
  const t = useT()
  return <PaneNavigation
    heading={<>
      <GitLabUserAvatar sessionId={sessionId} size={24} user={user} />
      {/* Name and username share one baseline. */}
      <Tooltip title={`${user.name} @${user.username}`}><Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexShrink: 1, minWidth: 0 }}>
        <Typography component="div" noWrap sx={{ minWidth: 0 }} variant="h1">{user.name || user.username}</Typography>
        <Typography color="textSecondary" component="div" noWrap sx={{ flexShrink: 0 }} variant="caption">@{user.username}{status ? ` · ${status}` : ''}</Typography>
      </Stack></Tooltip>
    </>}
    tabs={<Tabs aria-label={t('user.tabs.label')} onChange={(_, value: UserTab) => onTabChange(value)} scrollButtons="auto" value={tab} variant="scrollable">
      <Tab label={t('user.tabs.mergeRequests')} value="mrs" />
      <Tab label={t('user.tabs.projects')} value="projects" />
    </Tabs>}
  />
}

export function UserView({ initialParams, onOpenMergeRequest, onOpenProject, onOpenProjectId, onSearchStateChange, onTabChange, recentMrId, selected, username }: {
  initialParams: Record<string, string>
  onOpenMergeRequest: (mergeRequest: MergeRequest) => void
  onOpenProject: (project: Project) => void
  onOpenProjectId: (projectId: string) => void
  onSearchStateChange: (params: Record<string, string>) => void
  onTabChange: (tab: UserTab) => void
  recentMrId: string | null
  selected: MrRef | null
  username: string
}) {
  const { session } = useConnection()
  const t = useT()
  const query = useMemo(() => ({ kind: 'user' as const, username }), [username])
  const result = useGitLabQuery(session?.id ?? null, query)
  const user = result.data
  const tab: UserTab = initialParams.userTab === 'projects' ? 'projects' : 'mrs'
  if (!user) return <Box sx={{ display: 'flex', flex: 1, flexDirection: 'column', minHeight: 0 }}>
    <PaneHeader title={`@${username}`} />
    {result.loading ? <PaneStatus announcement={t('user.loading')}>{t('user.loading')}</PaneStatus>
      : result.error ? <Alert action={<Button color="inherit" onClick={result.refresh}>{t('user.retry')}</Button>} severity="error" sx={{ m: 1.5 }}>{result.error.message}</Alert>
      : result.snapshot ? <PaneEmpty description={t('user.notFound.description')} title={t('user.notFound.title')} /> : null}
  </Box>
  const status = result.stale ? t('user.status.saved', { time: formatFetchedAt(result.snapshot?.fetchedAt) }) : result.refreshing ? t('user.status.refreshing') : undefined
  const navigation = <UserNavigation onTabChange={onTabChange} sessionId={session?.id} status={status} tab={tab} user={user} />
  return <Box sx={{ display: 'flex', flex: 1, flexDirection: 'column', minHeight: 0 }}>
    {result.error ? <Alert action={<Button color="inherit" onClick={result.refresh}>{t('user.retry')}</Button>} severity="warning" sx={{ m: 1.5 }}>{t('user.refreshFailed', { message: result.error.message })}</Alert> : null}
    {tab === 'projects'
      ? <ProjectView key={user.id} navigation={navigation} onOpenProject={onOpenProject} onOpenProjectId={onOpenProjectId} user={user} />
      : <MergeRequestList author={user} initialParams={initialParams} navigation={navigation} onOpenMergeRequest={onOpenMergeRequest} onSearchStateChange={onSearchStateChange} recentMrId={recentMrId} selected={selected} />}
  </Box>
}
