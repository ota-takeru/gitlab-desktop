import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import KeyboardArrowLeftRoundedIcon from '@mui/icons-material/KeyboardArrowLeftRounded'
import KeyboardArrowRightRoundedIcon from '@mui/icons-material/KeyboardArrowRightRounded'
import LaunchRoundedIcon from '@mui/icons-material/LaunchRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

import { hairline } from '../../components/hairline'
import { PaneHeader } from '../../components/Pane'
import { paneGutter, paneResultsSx } from '../../components/paneSx'
import { Bar, Row } from '../../components/Row'
import { useT } from '../../i18n/useT'
import { isEditableTarget, isInsideControlGroup } from '../../lib/eventTargets'
import { formatAbsoluteTime, shortSha } from '../../lib/format'
import { commitUrl, normalizeGitLabError, openGitLabUrl } from '../../lib/gitlab'
import type { CommitDiffQuery, CommitMergeRequestsQuery, FileQuery, RepositoryCommitQuery } from '../../types/gitlab'
import { DiffViewer } from '../mergeRequests/DiffViewer'
import { LoadingSkeleton } from '../mergeRequests/LoadingPanel'
import { useAllDiffPages } from '../mergeRequests/useAllDiffPages'
import type { MrRef } from '../shared/personalWorkspace'
import { useGitLabQuery } from '../shared/useGitLabQuery'
import { ProjectFetchAlerts } from './ProjectFetchAlerts'

const noComment = () => undefined

/** One commit at the pane's full width: its message and the read-only changes from its parent. */
export function CommitDetail({ navigation, newer, older, onBack, onOpenMergeRequest, onSelect, projectId, projectName, projectUrl, sessionId, sha }: {
  navigation?: ReactNode
  /** The neighbours in the list it was opened from; a commit opened from elsewhere has none. */
  newer?: string
  older?: string
  onBack: () => void
  onOpenMergeRequest?: (ref: MrRef) => void
  onSelect: (sha: string) => void
  projectId: string
  projectName: string
  projectUrl?: string
  sessionId: string
  sha: string
}) {
  const t = useT()
  const commitQuery = useMemo<RepositoryCommitQuery>(() => ({ kind: 'repositoryCommit', projectId, sha }), [projectId, sha])
  const commit = useGitLabQuery(sessionId, commitQuery)
  const diffQuery = useMemo<CommitDiffQuery>(() => ({ kind: 'commitDiff', page: 1, projectId, sha }), [projectId, sha])
  const diffs = useAllDiffPages(sessionId, diffQuery)
  const relatedQuery = useMemo<CommitMergeRequestsQuery>(() => ({ kind: 'commitMergeRequests', projectId, sha }), [projectId, sha])
  const related = useGitLabQuery(sessionId, relatedQuery)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [view, setView] = useState<'diff' | 'file'>('diff')
  const [openError, setOpenError] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const diffList = diffs.data ?? []
  const selectedDiff = diffList.find((diff) => (diff.newPath || diff.oldPath) === selectedFile) ?? diffList[0]
  const fileQuery: FileQuery | null = view === 'file' && selectedDiff && !selectedDiff.deletedFile ? { kind: 'file', path: selectedDiff.newPath || selectedDiff.oldPath, projectId, sha } : null
  const file = useGitLabQuery(sessionId, fileQuery)
  const beforeSha = commit.data?.parentIds?.[0]
  const fileSource = useMemo(() => ({ projectId, sessionId, sha, ...(beforeSha ? { beforeSha } : {}), ...(projectUrl ? { projectUrl } : {}) }), [beforeSha, projectId, projectUrl, sessionId, sha])
  // The message's first line is the title; the rest is shown as it was written.
  const body = commit.data?.message?.split('\n').slice(1).join('\n').trim()

  // The keys work from the moment it opens, and moving to a neighbour starts at its top.
  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true })
    scrollRef.current?.scrollTo?.({ top: 0 })
  }, [sha])

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    // A popover's keys bubble here through React although it is outside on screen.
    if (event.altKey || event.ctrlKey || event.metaKey || isEditableTarget(event.target) || !event.currentTarget.contains(event.target as Node)) return
    // As in the rest of the app, Esc closes what has the focus before it leaves the screen.
    if (event.key === 'Escape') { if (!isInsideControlGroup(event.target)) onBack() }
    else if (event.key === 'j' && older) onSelect(older)
    else if (event.key === 'k' && newer) onSelect(newer)
  }
  const openInGitLab = () => {
    if (!projectUrl) return
    setOpenError(null)
    void openGitLabUrl(sessionId, commitUrl(projectUrl, sha)).catch((error: unknown) => setOpenError(normalizeGitLabError(error).message))
  }
  const refresh = () => { commit.refresh(); diffs.refresh(); related.refresh() }

  return <Box onKeyDown={onKeyDown} ref={rootRef} sx={{ display: 'flex', flex: 1, flexDirection: 'column', minHeight: 0, outline: 'none' }} tabIndex={-1}>
    <PaneHeader
      actions={<>
        {projectUrl ? <Tooltip title={t('project.history.openInGitLab')}><IconButton aria-label={t('project.history.openInGitLab')} onClick={openInGitLab}><LaunchRoundedIcon /></IconButton></Tooltip> : null}
        <Tooltip title={t('project.refresh')}><span><IconButton aria-label={t('project.refresh')} disabled={commit.loading || commit.refreshing} onClick={refresh}><RefreshRoundedIcon /></IconButton></span></Tooltip>
      </>}
      navigation={navigation}
      title={commit.data?.title || t('project.history.title', { project: projectName })}
    >
      <Bar spacing={0.5}>
        <Button onClick={onBack} startIcon={<ArrowBackRoundedIcon />}>{t('project.history.back')}</Button>
        {newer || older ? <Row spacing={0.25} sx={{ ml: 'auto !important' }}>
          <Tooltip title={t('project.history.newer')}><span><IconButton aria-label={t('project.history.newer')} disabled={!newer} onClick={() => { if (newer) onSelect(newer) }}><KeyboardArrowLeftRoundedIcon /></IconButton></span></Tooltip>
          <Tooltip title={t('project.history.older')}><span><IconButton aria-label={t('project.history.older')} disabled={!older} onClick={() => { if (older) onSelect(older) }}><KeyboardArrowRightRoundedIcon /></IconButton></span></Tooltip>
        </Row> : null}
      </Bar>
    </PaneHeader>
    <Box ref={scrollRef} sx={paneResultsSx(false)}>
      <ProjectFetchAlerts error={commit.error} failed={commit.error?.message ?? ''} hasData={Boolean(commit.data)} onRetry={commit.refresh} refreshFailed={t('project.status.refreshFailed', { message: commit.error?.message ?? '' })} />
      <Stack spacing={1} sx={{ ...hairline('bottom'), px: paneGutter, py: 1.5 }}>
        <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }} variant="body1">{commit.data ? commit.data.title || t('review.blame.noMessage') : commit.loading ? t('project.history.loading') : shortSha(sha)}</Typography>
        {body ? <Typography color="textSecondary" sx={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }} variant="body2">{body}</Typography> : null}
        {commit.data ? <Typography color="textSecondary" variant="caption"><Box component="span" sx={{ fontFamily: 'code.fontFamily', verticalAlign: 'top' }}>{shortSha(sha)}</Box> · {commit.data.authorName || t('review.blame.unknownAuthor')} · {formatAbsoluteTime(commit.data.committedAt ?? commit.data.createdAt)}</Typography> : null}
        {related.data?.length ? <Row spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
          <Typography color="textSecondary" variant="caption">{t('review.blame.relatedMrs')}</Typography>
          {related.data.map((mr) => <Button key={`${mr.projectId}:${mr.iid}`} onClick={() => onOpenMergeRequest?.({ iid: mr.iid, projectId: mr.projectId })} size="small" sx={{ justifyContent: 'flex-start', textAlign: 'left' }}>!{mr.iid} {mr.title}</Button>)}
        </Row> : null}
        {openError ? <Alert severity="warning">{t('project.branches.openFailed', { message: openError })}</Alert> : null}
      </Stack>
      <Stack spacing={1.5} sx={{ px: paneGutter, py: 1.5 }}>
        {diffs.snapshot?.completeness === 'truncated' ? <Alert severity="warning">{t('review.changes.truncated')}</Alert> : null}
        {diffs.error && !diffs.data ? <Alert severity="error">{t('review.changes.diffError', { message: diffs.error.message })}</Alert> : null}
        {diffs.loading && !diffs.data ? <LoadingSkeleton label={t('review.changes.loading')} variant="changes" /> : null}
        {!diffs.loading && diffs.data && !diffList.length ? <Typography color="textSecondary" role="status" variant="body2">{t('project.history.noChanges')}</Typography> : null}
        {diffList.length ? <DiffViewer allowComments={false} diffs={diffList} fileContent={file.data?.content} fileLoading={file.loading} fileSource={fileSource} key={sha} onComment={noComment} onSelectFile={setSelectedFile} onViewChange={setView} selectedFile={selectedFile} selectedPosition={undefined} view={view} /> : null}
        {file.error ? <Alert severity="error">{t('review.changes.fileError', { message: file.error.message })}</Alert> : null}
      </Stack>
    </Box>
  </Box>
}
