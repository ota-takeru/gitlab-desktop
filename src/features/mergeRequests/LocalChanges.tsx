import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { RelativeTime } from '../../components/RelativeTime'
import { delayedRevealSx } from '../../components/paneSx'
import { shortSha } from '../../lib/format'
import { getLocalChanges, getLocalFile, getLocalRepository, linkLocalRepository, pickLocalRepositoryFolder, unlinkLocalRepository } from '../../lib/localRepository'
import { normalizeGitLabError } from '../../lib/gitlab'
import { DiffViewer } from './DiffViewer'

const NO_COMMENT = () => undefined
const codeSx = { color: 'text.primary', fontFamily: 'code.fontFamily' } as const

/**
 * The MR's changes as they are in the user's own clone: its working tree
 * (unpushed commits, uncommitted edits and untracked files) against the MR head. Read-only:
 * nothing here comments, marks files reviewed, fetches or changes the clone.
 */
export function LocalChanges({ headSha, onSelectFile, projectId, projectPath, selectedFile, sessionId }: { headSha: string; onSelectFile: (path: string) => void; projectId: string; projectPath: string | null; selectedFile: string | null; sessionId: string }) {
  const client = useQueryClient()
  const repositoryKey = ['localRepository', sessionId, projectId]
  const repository = useQuery({ queryFn: () => getLocalRepository(sessionId, projectId), queryKey: repositoryKey, staleTime: Infinity })
  const linked = repository.data ?? null
  // The working tree changes outside the app, so it is read again each time the view opens.
  const changes = useQuery({ enabled: Boolean(linked), gcTime: 0, queryFn: () => getLocalChanges(sessionId, projectId, headSha), queryKey: ['localChanges', sessionId, projectId, headSha, linked?.path], staleTime: 0 })
  const [unlinking, setUnlinking] = useState(false)
  const [unlinkError, setUnlinkError] = useState<string | null>(null)
  const [viewChoice, setViewChoice] = useState<{ path: string; view: 'diff' | 'file' } | null>(null)
  // Linking or unlinking replaces the focused control, so focus moves to its
  // counterpart as soon as that mounts.
  const focusAfter = useRef<'linked' | 'unlinked' | null>(null)
  const focusOnMount = (target: 'linked' | 'unlinked') => (node: HTMLElement | null) => {
    if (node && focusAfter.current === target) {
      node.focus()
      focusAfter.current = null
    }
  }
  // The shown file as it is now, for the whole-file view and for opening the lines between hunks.
  const shown = changes.data?.diffs.find((diff) => (diff.newPath || diff.oldPath) === selectedFile) ?? changes.data?.diffs[0]
  const readable = Boolean(shown && !shown.deletedFile && !shown.tooLarge)
  const shownPath = shown ? (shown.newPath || shown.oldPath) : ''
  const view = viewChoice?.path === shownPath ? viewChoice.view : 'diff'
  const file = useQuery({ enabled: readable, gcTime: 0, queryFn: () => getLocalFile(sessionId, projectId, shown?.newPath ?? ''), queryKey: ['localFile', sessionId, projectId, shown?.newPath, changes.dataUpdatedAt], staleTime: 0 })

  if (repository.isPending) return <Typography color="textSecondary" role="status" sx={{ ...delayedRevealSx, py: 2 }} variant="body2">ローカルリポジトリの紐付けを確認中…</Typography>
  if (repository.error) return <Alert severity="error">ローカルリポジトリの紐付けを読めませんでした: {normalizeGitLabError(repository.error).message}</Alert>
  if (!linked) return <LinkRepository fieldRef={focusOnMount('unlinked')} onLinked={(next) => { focusAfter.current = 'linked'; client.setQueryData(repositoryKey, next) }} projectId={projectId} projectPath={projectPath} sessionId={sessionId} />

  const unlink = async () => {
    setUnlinking(true)
    setUnlinkError(null)
    try {
      await unlinkLocalRepository(sessionId, projectId)
      focusAfter.current = 'unlinked'
      client.setQueryData(repositoryKey, null)
    } catch (error) {
      setUnlinkError(normalizeGitLabError(error).message)
    } finally {
      setUnlinking(false)
    }
  }
  const data = changes.data
  const error = changes.error ? normalizeGitLabError(changes.error) : null
  // Facts about the clone, on one line so the diff starts close to the comparison targets.
  const facts = data ? [
    <>ブランチ <Box component="span" sx={codeSx}>{data.branch ?? '（detached HEAD）'}</Box></>,
    data.localHead ? <>HEAD <Box component="span" sx={codeSx}>{shortSha(data.localHead)}</Box></> : null,
    data.containsMrHead && data.aheadCount ? `MRの最新より${data.aheadCount}コミット先（未push）` : null,
    data.untrackedIncluded ? `未追跡${data.untrackedIncluded}件を含む` : null,
  ].filter(Boolean) : []
  // The same facts as text, for the tooltip when the line is cut off.
  const factsText = data ? [
    `ブランチ ${data.branch ?? '（detached HEAD）'}`,
    data.localHead ? `HEAD ${shortSha(data.localHead)}` : null,
    data.containsMrHead && data.aheadCount ? `MRの最新より${data.aheadCount}コミット先（未push）` : null,
    data.untrackedIncluded ? `未追跡${data.untrackedIncluded}件を含む` : null,
  ].filter(Boolean).join(' · ') : ''
  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
        <Tooltip title={linked.path}><Typography color="textSecondary" noWrap sx={{ flex: '0 1 auto', minWidth: 48 }} variant="caption"><Box component="span" sx={codeSx}>{linked.path}</Box></Typography></Tooltip>
        <Tooltip title={factsText}><Typography color="textSecondary" noWrap sx={{ flex: '1 1 auto', minWidth: 0 }} variant="caption">{facts.map((fact, index) => <span key={index}>{index ? ' · ' : ''}{fact}</span>)}</Typography></Tooltip>
        {changes.isFetching && data ? <Typography color="textSecondary" role="status" sx={{ flexShrink: 0 }} variant="caption">読み直し中…</Typography> : changes.dataUpdatedAt && data ? <Box sx={{ flexShrink: 0 }}><RelativeTime prefix="読み取り" value={new Date(changes.dataUpdatedAt).toISOString()} /></Box> : null}
        <Tooltip title="作業ツリーを読み直す"><span><IconButton aria-disabled={changes.isFetching} aria-label="ローカルの変更を読み直す" onClick={() => { if (!changes.isFetching) void changes.refetch() }} ref={focusOnMount('linked')}><RefreshRoundedIcon /></IconButton></span></Tooltip>
        <Button disabled={unlinking} onClick={() => void unlink()} size="small" sx={{ flexShrink: 0 }}>紐付けを解除</Button>
      </Stack>
      {unlinkError ? <Alert severity="error">紐付けを解除できませんでした: {unlinkError}</Alert> : null}
      {error && !data ? <Alert severity="error">ローカルの変更を読めませんでした: {error.message}</Alert> : null}
      {error && data ? <Alert severity="warning">前回読み取った差分を表示中です。読み直しに失敗しました: {error.message}</Alert> : null}
      {changes.isPending && !error ? <Typography color="textSecondary" role="status" sx={{ ...delayedRevealSx, py: 2 }} variant="body2">ローカルの変更を読み込み中…</Typography> : null}
      {data && !data.containsMrHead ? <Alert severity="warning">ローカルのHEADはMRの最新コミット {shortSha(data.comparedSha)} を含んでいません。MRにだけある変更は、ここでは取り消しとして表示されます。</Alert> : null}
      {data?.truncated ? <Alert severity="warning">差分が大きすぎるため途中で打ち切りました。一部のファイルが表示されていません。</Alert> : null}
      {data && (data.untrackedCount > data.untrackedIncluded || data.untrackedMore) ? <Alert severity="warning">未追跡のファイルのうち{data.untrackedCount - data.untrackedIncluded}件{data.untrackedMore ? '以上' : ''}は、件数か大きさの上限を超えたため差分に含めていません。</Alert> : null}
      {data && !data.diffs.length && !data.truncated ? <Typography color="textSecondary" role="status" variant="body2">MRの最新コミットとローカルの作業ツリーに差分はありません。</Typography> : null}
      {data?.diffs.length ? <DiffViewer allowComments={false} diffs={data.diffs} fileContent={readable ? file.data?.content : null} fileLoading={file.isFetching} key={`local:${headSha}`} onComment={NO_COMMENT} onSelectFile={onSelectFile} onViewChange={(next) => setViewChoice({ path: shownPath, view: next })} selectedFile={selectedFile} selectedPosition={undefined} view={view} /> : null}
      {view === 'file' && shown?.deletedFile ? <Typography color="textSecondary" role="status" variant="body2">このファイルは作業ツリーで削除されています。</Typography> : null}
      {view === 'file' && file.error ? <Alert severity="error">ファイル全体を読めませんでした: {normalizeGitLabError(file.error).message}</Alert> : null}
    </Stack>
  )
}

function LinkRepository({ fieldRef, onLinked, projectId, projectPath, sessionId }: { fieldRef: (node: HTMLElement | null) => void; onLinked: (repository: Awaited<ReturnType<typeof linkLocalRepository>>) => void; projectId: string; projectPath: string | null; sessionId: string }) {
  const [path, setPath] = useState('')
  const [linking, setLinking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (folder = path) => {
    if (!projectPath || !folder.trim()) return
    setLinking(true)
    setError(null)
    try {
      onLinked(await linkLocalRepository(sessionId, projectId, projectPath, folder))
    } catch (cause) {
      setError(normalizeGitLabError(cause).message)
    } finally {
      setLinking(false)
    }
  }
  const pick = async () => {
    setError(null)
    try {
      const folder = await pickLocalRepositoryFolder()
      if (!folder) return
      setPath(folder)
      await submit(folder)
    } catch (cause) {
      setError(normalizeGitLabError(cause).message)
    }
  }
  return (
    <Stack component="form" onSubmit={(event) => { event.preventDefault(); void submit() }} spacing={1}>
      <Typography variant="body2">このプロジェクトをcloneしたフォルダを紐付けると、MRの最新コミットとローカルの作業ツリーの差（未pushのコミット、未コミットの変更、未追跡ファイル）を表示できます。</Typography>
      <Typography color="textSecondary" variant="caption">フォルダは読み取るだけで、fetchや変更はしません。gitリモートが {projectPath ?? 'このプロジェクト'} を指していることを確認してから紐付けます。</Typography>
      {projectPath ? null : <Alert severity="warning">GitLabがこのMRのプロジェクトのパスを返さなかったため、紐付けを確認できません。</Alert>}
      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
        <TextField disabled={linking || !projectPath} fullWidth onChange={(event) => setPath(event.target.value)} inputRef={fieldRef} placeholder={'C:\\path\\to\\repository'} size="small" slotProps={{ htmlInput: { 'aria-label': 'ローカルリポジトリのフォルダ', spellCheck: false } }} value={path} />
        <Button disabled={linking || !projectPath} onClick={() => void pick()} sx={{ flexShrink: 0 }} variant="outlined">フォルダを選択…</Button>
        <Button disabled={linking || !projectPath || !path.trim()} sx={{ flexShrink: 0 }} type="submit" variant="contained">{linking ? '確認中…' : '紐付ける'}</Button>
      </Stack>
      {error ? <Alert severity="error">{error}</Alert> : null}
    </Stack>
  )
}
