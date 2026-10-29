import ArrowUpwardRoundedIcon from '@mui/icons-material/ArrowUpwardRounded'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined'
import LinkRoundedIcon from '@mui/icons-material/LinkRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Breadcrumbs from '@mui/material/Breadcrumbs'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Link from '@mui/material/Link'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useMemo, useState, type ReactNode } from 'react'

import { hairline } from '../../components/hairline'
import { ListRow } from '../../components/ListRow'
import { MarkdownLinkProvider } from '../../components/MarkdownLinks'
import { moveListRowFocus } from '../../components/listRowFocus'
import { PaneEmpty, PaneHeader, PaneStatus } from '../../components/Pane'
import { paneResultsSx } from '../../components/paneSx'
import { Pager } from '../../components/Pager'
import { translate } from '../../i18n/i18n'
import { useT } from '../../i18n/useT'
import { formatFetchedAt } from '../../lib/format'
import { languageForPath } from '../../lib/syntaxHighlight'
import type { BlobQuery, BranchesQuery, TreeEntry, TreeQuery } from '../../types/gitlab'
import { useConnection } from '../connections/connectionContext'
import { FullFileView } from '../mergeRequests/DiffViewer'
import { useGitLabQuery } from '../shared/useGitLabQuery'
import { Row } from '../../components/Row'

/** Where the code browser is: a branch (none for the default one), a folder, and the file open in it. */
export interface CodeLocation {
  ref?: string
  /** The folder shown, '' for the top. */
  path: string
  /** The file shown instead of the folder, by its path and the blob id from the listing. */
  file?: { path: string; sha: string }
}

/**
 * A project's repository, one folder at a time; a file opens in place with
 * line numbers and highlighting. Read only, and fetched only when shown.
 */
export function CodeBrowser({ location, navigation, onNavigate, projectId, projectName, projectUrl }: { location: CodeLocation; navigation?: ReactNode; onNavigate: (next: CodeLocation) => void; projectId: string; projectName: string; projectUrl?: string }) {
  const { session } = useConnection()
  const t = useT()
  const { file, path, ref } = location
  // Pages of a large folder; a different folder or branch starts at its first page.
  const folderKey = `${ref ?? ''}\n${path}`
  const [paging, setPaging] = useState({ folderKey, page: 1 })
  // Relative images in a Markdown file are read from the same branch.
  const filePath = file?.path
  const markdownRepository = useMemo(() => filePath ? { projectId, path: filePath, ...(ref ? { ref } : {}) } : undefined, [filePath, projectId, ref])
  const page = paging.folderKey === folderKey ? paging.page : 1
  const treeQuery = useMemo<TreeQuery | null>(() => file ? null : { kind: 'tree', page, path, projectId, ...(ref ? { ref } : {}) }, [file, page, path, projectId, ref])
  const tree = useGitLabQuery(session?.id ?? null, session ? treeQuery : null, { keepPrevious: true })
  const blobQuery = useMemo<BlobQuery | null>(() => file ? { kind: 'blob', projectId, sha: file.sha } : null, [file, projectId])
  const blob = useGitLabQuery(session?.id ?? null, session ? blobQuery : null)
  const branchesQuery = useMemo<BranchesQuery>(() => ({ kind: 'branches', page: 1, projectId, search: '' }), [projectId])
  const branches = useGitLabQuery(session?.id ?? null, session ? branchesQuery : null)

  if (!session) {
    return <PaneEmpty description={t('project.connect.code')} title={t('project.connect.title')}><Button href="#client/settings" variant="contained">{t('project.connect.openSettings')}</Button></PaneEmpty>
  }

  const shown = file ? blob : tree
  const freshness = shown.stale ? ` · ${t('project.status.saved', { time: formatFetchedAt(shown.snapshot?.fetchedAt) })}` : shown.refreshing ? ` · ${t('project.status.refreshing')}` : ''
  const segments = path ? path.split('/') : []
  const openFolder = (folder: string) => onNavigate({ path: folder, ref })
  const entries = sortEntries(tree.data ?? [])
  // The branch list is the 30 most recently updated; a branch chosen earlier stays selectable.
  const branchNames = (branches.data ?? []).map((branch) => branch.name)
  const defaultBranch = branches.data?.find((branch) => branch.default)?.name
  if (ref && !branchNames.includes(ref)) branchNames.unshift(ref)

  return (
    <Box component="section" sx={{ display: 'flex', flex: 1, flexDirection: 'column', minHeight: 0 }}>
      <PaneHeader
        actions={<Tooltip title={t('project.refresh')}><span><IconButton aria-label={t('project.refresh')} disabled={shown.loading || shown.refreshing} onClick={shown.refresh}><RefreshRoundedIcon /></IconButton></span></Tooltip>}
        navigation={navigation}
        title={t('project.code.title', { project: projectName })}
      >
        <Row spacing={1} sx={{ minWidth: 0 }}>
          <Select
            aria-label={t('project.code.branch')}
            displayEmpty
            onChange={(event) => onNavigate({ path: '', ...(event.target.value ? { ref: event.target.value } : {}) })}
            renderValue={(value) => value || (defaultBranch ? t('project.code.defaultBranchNamed', { branch: defaultBranch }) : t('project.code.defaultBranch'))}
            sx={{ flexShrink: 0, fontFamily: 'code.fontFamily', maxWidth: 240, typography: 'body2' }}
            value={ref ?? ''}
          >
            <MenuItem value="">{defaultBranch ? t('project.code.defaultBranchNamed', { branch: defaultBranch }) : t('project.code.defaultBranch')}</MenuItem>
            {branchNames.filter((name) => name !== defaultBranch).map((name) => <MenuItem key={name} sx={{ fontFamily: 'code.fontFamily' }} value={name}>{name}</MenuItem>)}
          </Select>
          <Breadcrumbs aria-label={t('project.code.location')} maxItems={6} sx={{ minWidth: 0, typography: 'body2' }}>
            {segments.length || file ? <Link component="button" onClick={() => openFolder('')} type="button" underline="hover">{projectName}</Link> : <Typography color="textPrimary" variant="body2">{projectName}</Typography>}
            {segments.map((segment, index) => {
              const folder = segments.slice(0, index + 1).join('/')
              return index < segments.length - 1 || file
                ? <Link component="button" key={folder} onClick={() => openFolder(folder)} type="button" underline="hover">{segment}</Link>
                : <Typography color="textPrimary" key={folder} variant="body2">{segment}</Typography>
            })}
            {file ? <Typography color="textPrimary" sx={{ fontFamily: 'code.fontFamily' }} variant="body2">{file.path.split('/').at(-1)}</Typography> : null}
          </Breadcrumbs>
        </Row>
      </PaneHeader>
      <PaneStatus announcement={file ? null : tree.data && !tree.previous ? t('project.code.count', { count: entries.length }) : null}>
        {file
          ? <>{file.path}{freshness}</>
          : tree.data && !tree.previous ? <>{t('project.code.count', { count: entries.length })}{page > 1 || tree.snapshot?.nextPage != null ? ` · ${t('project.status.page', { page })}` : ''}{freshness}</> : tree.loading || tree.previous ? t('project.code.loading') : null}
      </PaneStatus>
      <Box aria-busy={!file && tree.previous} sx={paneResultsSx(!file && tree.previous)}>
        {shown.error && !shown.data ? <Alert action={<Button color="inherit" onClick={shown.refresh}>{t('project.retry')}</Button>} severity="error" sx={{ m: 1.5 }}>{errorMessage(shown.error, Boolean(file), path)}</Alert> : null}
        {shown.error && shown.data ? <Alert action={<Button color="inherit" onClick={shown.refresh}>{t('project.retry')}</Button>} severity="warning" sx={{ m: 1.5 }}>{t('project.code.refreshFailed', { message: shown.error.message })}</Alert> : null}
        {file
          ? shown.error && !shown.data ? null : <MarkdownLinkProvider instanceUrl={session.instanceUrl} projectUrl={projectUrl} repository={markdownRepository} sessionId={session.id}><FullFileView key={`${file.path}:${file.sha}`} content={blob.data?.content} language={languageForPath(file.path)} loading={blob.loading} path={file.path} /></MarkdownLinkProvider>
          : <>
            {tree.data && entries.length === 0 && !path ? <PaneEmpty description={t('project.code.empty.description')} icon={<FolderOutlinedIcon fontSize="inherit" />} title={t('project.code.empty.title')} /> : null}
            {tree.data && (entries.length || path) ? <Box aria-label={t('project.code.label')} component="ul" onKeyDown={moveListRowFocus} sx={{ m: 0, p: 0 }}>
              {path ? <ListRow ariaLabel={t('project.code.parentFolder')} leading={<ArrowUpwardRoundedIcon sx={{ color: 'text.secondary', fontSize: 16 }} />} onOpen={() => openFolder(segments.slice(0, -1).join('/'))}><Typography variant="body2">..</Typography></ListRow> : null}
              {entries.map((entry) => <TreeRow entry={entry} key={entry.path} onOpenFile={() => onNavigate({ file: { path: entry.path, sha: entry.id }, path, ref })} onOpenFolder={() => openFolder(entry.path)} />)}
            </Box> : null}
          </>}
      </Box>
      {!file && tree.data && (page > 1 || tree.snapshot?.nextPage != null) ? <Box sx={{ ...hairline('top'), px: 1, py: 0.5 }}><Pager disabled={tree.refreshing} hasNext={tree.snapshot?.nextPage != null} hasPrevious={page > 1} onNext={() => setPaging({ folderKey, page: tree.snapshot!.nextPage! })} onPrevious={() => setPaging({ folderKey, page: Math.max(1, page - 1) })} page={page} /></Box> : null}
    </Box>
  )
}

function TreeRow({ entry, onOpenFile, onOpenFolder }: { entry: TreeEntry; onOpenFile: () => void; onOpenFolder: () => void }) {
  const t = useT()
  const icon = entry.type === 'tree' ? <FolderOutlinedIcon sx={{ color: 'place.projects', fontSize: 16 }} /> : entry.type === 'commit' ? <LinkRoundedIcon sx={{ color: 'text.secondary', fontSize: 16 }} /> : <InsertDriveFileOutlinedIcon sx={{ color: 'text.secondary', fontSize: 16 }} />
  // A submodule points at another repository, so it has nothing to open here.
  return <ListRow disabled={entry.type === 'commit'} leading={icon} onOpen={entry.type === 'tree' ? onOpenFolder : onOpenFile}>
    <Row spacing={1} sx={{ minWidth: 0 }}>
      <Typography noWrap sx={{ fontFamily: 'code.fontFamily', minWidth: 0 }} variant="body2">{entry.name}</Typography>
      {entry.type === 'commit' ? <Typography color="textSecondary" variant="caption">{t('project.code.submodule')}</Typography> : null}
    </Row>
  </ListRow>
}

/** Folders first, then files, each by name, as GitLab shows a repository. */
function sortEntries(entries: TreeEntry[]): TreeEntry[] {
  return [...entries].sort((left, right) => Number(left.type !== 'tree') - Number(right.type !== 'tree') || left.name.localeCompare(right.name))
}

function errorMessage(error: { code?: string; message: string }, file: boolean, path: string): string {
  if (error.code !== 'NOT_FOUND') return error.message
  if (file) return translate('project.code.fileNotFound')
  return translate(path ? 'project.code.folderNotFound' : 'project.code.repositoryNotFound')
}
