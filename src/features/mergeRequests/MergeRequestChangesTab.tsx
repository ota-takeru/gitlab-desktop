import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useEffect, useRef, useState } from 'react'
import { formatAbsoluteTime, shortSha } from '../../lib/format'
import type { Commit, Diff, Discussion, Draft, MrVersion, Position } from '../../types/gitlab'
import type { ThreadActions } from './DiffThreads'
import { DiffViewer } from './DiffViewer'
import type { ReviewedFileContext } from './useReviewedFiles'
import type { SuggestionActions } from './SuggestionBlock'
import { LoadingPanel } from './LoadingPanel'

/** The MR's versions, and the earlier one the changes tab compares from, if any. */
export interface VersionChoice {
  compareFrom: string | null
  error: Error | null
  headSha?: string
  items: MrVersion[]
  loading: boolean
  /** GitLab has older versions than the listed ones. */
  more: boolean
  /** Null returns to the whole MR. */
  onSelect: (headCommitSha: string | null) => void
}

export function ChangesTab({ compareBaseSha, local, fileSource, threadActions, pendingDrafts, lineComposer, discussions, discussionHeadSha, discussionsIncomplete, onOpenDiscussion, reviewContext, allowComments, changeNextPage, changePage, changesError, changesLoading, changesTruncated, commitNextPage, commitPage, commits, commitsError, commitsLoading, diffs, fileResult, fileView, onComment, onNextChangePage, onNextCommitPage, onPrevChangePage, onPrevCommitPage, onSelectCommit, onSelectFile, onViewChange, selectedCommit, selectedFile, selectedPosition, suggestionActions, versions }: { compareBaseSha?: string; local?: LocalChoice; fileSource?: { sessionId: string; projectId: string; sha: string; beforeSha?: string }; reviewContext?: ReviewedFileContext; allowComments: boolean; changeNextPage: number | null; changePage: number; changesError: Error | null; changesLoading: boolean; changesTruncated: boolean; commitNextPage: number | null; commitPage: number; commits: Commit[]; commitsError: Error | null; commitsLoading: boolean; diffs: Diff[]; fileResult: { data: { content: string } | null; loading: boolean; error: Error | null }; fileView: 'diff' | 'file'; onComment: (position: Position) => void; onNextChangePage: () => void; onNextCommitPage: () => void; onPrevChangePage: () => void; onPrevCommitPage: () => void; onSelectCommit: (sha: string | null) => void; onSelectFile: (path: string) => void; onViewChange: (view: 'diff' | 'file') => void; selectedCommit: string | null; selectedFile: string | null; selectedPosition?: Position; discussions?: Discussion[]; discussionHeadSha?: string; discussionsIncomplete: boolean; onOpenDiscussion: (discussionId: string) => void; lineComposer?: { position: Position; node: React.ReactNode }; pendingDrafts?: Draft[]; threadActions?: ThreadActions; suggestionActions?: SuggestionActions; versions: VersionChoice }) {
  const compareFrom = versions.compareFrom
  const showingLocal = Boolean(local?.active)
  return (
    <Stack spacing={1.5}>
      {commitsError && !commits.length ? <Alert severity="error">コミットを取得できませんでした: {commitsError.message}</Alert> : null}
      {commitsError && commits.length ? <Alert severity="warning">保存済みのコミットを表示中です。更新に失敗しました: {commitsError.message}</Alert> : null}
      {!commitsError || commits.length ? <CommitTimeline baseSha={compareBaseSha} commits={commits} compareFrom={compareFrom} local={local} headSha={discussionHeadSha} loading={commitsLoading} nextPage={commitNextPage} onNextPage={onNextCommitPage} onPrevPage={onPrevCommitPage} onSelect={onSelectCommit} page={commitPage} selected={selectedCommit} versionPicker={<VersionPicker versions={versions} />} /> : null}
      {showingLocal ? local?.content : <>
      {changesTruncated ? <Alert severity="warning">GitLabがバージョン間の比較を上限で打ち切ったため、一部のファイルが表示されていません。GitLabで確認してください。</Alert> : null}
      {changesError && !diffs.length ? <Alert severity="error">差分を取得できませんでした: {changesError.message}</Alert> : null}
      {changesError && diffs.length ? <Alert severity="warning">保存済みの差分を表示中です。更新に失敗しました: {changesError.message}</Alert> : null}
      {changesLoading && !diffs.length ? <LoadingPanel label="変更を読み込み中…" /> : null}
      {!changesLoading && !changesError && compareFrom && changePage === 1 && !diffs.length ? <Typography color="textSecondary" role="status" variant="body2">このバージョンから最新までの変更はありません。</Typography> : null}
      {(!changesLoading || diffs.length) && (!changesError || diffs.length) ? <DiffViewer threadActions={threadActions} pendingDrafts={pendingDrafts} lineComposer={lineComposer} discussionHeadSha={discussionHeadSha} discussions={discussions} discussionsIncomplete={discussionsIncomplete} onOpenDiscussion={onOpenDiscussion} reviewContext={!changesLoading && !changesError ? reviewContext : undefined} key={selectedCommit ?? (compareFrom ? `version:${compareFrom}` : 'mr')} allowComments={allowComments} diffs={diffs} fileContent={fileResult.data?.content} fileLoading={fileResult.loading} fileSource={fileSource} onComment={onComment} onSelectFile={onSelectFile} onViewChange={onViewChange} selectedFile={selectedFile} selectedPosition={selectedPosition} suggestionActions={suggestionActions} view={fileView} /> : null}
      {fileResult.error ? <Alert severity="error">ファイル全体を取得できませんでした: {fileResult.error.message}</Alert> : null}
      {changeNextPage !== null || changePage > 1 ? <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', justifyContent: 'flex-end' }}><Button aria-label="差分の前のページ" disabled={changePage <= 1} onClick={onPrevChangePage} size="small">前へ</Button><Typography color="textSecondary" variant="caption">差分のページ {changePage}</Typography><Button aria-label="差分の次のページ" disabled={changeNextPage === null} onClick={onNextChangePage} size="small">次へ</Button></Stack> : null}
      </>}
    </Stack>
  )
}

function CommitTimeline({ baseSha, commits, compareFrom, local, headSha, loading, nextPage, onNextPage, onPrevPage, onSelect, page, selected, versionPicker }: { baseSha?: string; commits: Commit[]; compareFrom: string | null; local?: LocalChoice; headSha?: string; loading: boolean; nextPage: number | null; onNextPage: () => void; onPrevPage: () => void; onSelect: (sha: string | null) => void; page: number; selected: string | null; versionPicker: React.ReactNode }) {
  const showingLocal = Boolean(local?.active)
  const wholeMergeRequest = selected === null && !compareFrom && !showingLocal
  const item = (active: boolean) => ({ bgcolor: active ? 'surface.selected' : 'transparent', border: 1, borderColor: active ? 'primary.main' : 'divider', borderRadius: 1, color: active ? 'text.primary' : 'text.secondary', flexShrink: 0, fontWeight: active ? 600 : 400, minHeight: 28, px: 1, '&:hover': { bgcolor: active ? 'surface.selected' : 'action.hover', borderColor: active ? 'primary.main' : 'surface.borderStrong' } })
  // One tab stop for the whole row (the chosen item); ←/→ Home/End move between items.
  const tabStop = selected !== null && commits.some((commit) => commit.id === selected) ? selected : null
  const moveFocus = (event: React.KeyboardEvent<HTMLElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[data-commit-item]'))
    const current = items.indexOf(document.activeElement as HTMLElement)
    if (current < 0) return
    event.preventDefault()
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : Math.min(items.length - 1, Math.max(0, current + (event.key === 'ArrowRight' ? 1 : -1)))
    items[next].focus()
    items[next].scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }
  // Many commits stay on one line; the arrows scroll it when it is wider than the pane.
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [overflow, setOverflow] = useState({ left: false, right: false })
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller || typeof ResizeObserver === 'undefined') return
    const update = () => setOverflow({ left: scroller.scrollLeft > 0, right: scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 1 })
    // The observer reports the first size as soon as it starts observing.
    const observer = new ResizeObserver(update)
    observer.observe(scroller)
    if (scroller.firstElementChild) observer.observe(scroller.firstElementChild)
    scroller.addEventListener('scroll', update, { passive: true })
    return () => { observer.disconnect(); scroller.removeEventListener('scroll', update) }
  }, [])
  const scrollBy = (direction: 1 | -1) => {
    const scroller = scrollerRef.current
    scroller?.scrollBy?.({ behavior: 'smooth', left: direction * scroller.clientWidth * 0.8 })
  }
  const scrollable = overflow.left || overflow.right
  return <Stack spacing={0.5}>
    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', minWidth: 0 }}>
      {page > 1 ? <Button onClick={onPrevPage} size="small" sx={{ flexShrink: 0 }}>前のコミット</Button> : null}
      {scrollable ? <Tooltip title="左へスクロール"><span><IconButton aria-label="コミットの帯を左へスクロール" disabled={!overflow.left} onClick={() => scrollBy(-1)}><ChevronLeftRoundedIcon /></IconButton></span></Tooltip> : null}
      <Box aria-label="比較対象" onKeyDown={moveFocus} ref={scrollerRef} role="toolbar" sx={{ flex: 1, minWidth: 0, overflowX: 'auto', pb: 0.5 }}><Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', minWidth: 'max-content' }}>
        <Button aria-pressed={wholeMergeRequest} color="inherit" data-commit-item onClick={() => onSelect(null)} sx={item(wholeMergeRequest)} tabIndex={tabStop === null ? 0 : -1}>MR全体</Button>
        {loading ? <Typography color="textSecondary" sx={{ px: 1 }} variant="caption">コミットを読み込み中…</Typography> : commits.map((commit) => { const time = commit.committedAt || commit.createdAt; return <Tooltip describeChild key={commit.id} title={`${commit.title}\n${formatAbsoluteTime(time)}`}><Button aria-pressed={selected === commit.id} color="inherit" data-commit-item onClick={() => onSelect(commit.id)} sx={{ ...item(selected === commit.id), justifyContent: 'flex-start', gap: 1, maxWidth: 420 }} tabIndex={tabStop === commit.id ? 0 : -1}><Box component="span" sx={{ color: 'primary.main', fontFamily: 'code.fontFamily', fontSize: 'caption.fontSize', flexShrink: 0 }}>{shortSha(commit.id)}</Box><Box component="span" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{commit.title}</Box>{time ? <Box component="time" dateTime={time} sx={{ color: 'text.secondary', flexShrink: 0, fontSize: 'caption.fontSize' }}>{formatAbsoluteTime(time)}</Box> : null}</Button></Tooltip> })}
      </Stack></Box>
      {scrollable ? <Tooltip title="右へスクロール"><span><IconButton aria-label="コミットの帯を右へスクロール" disabled={!overflow.right} onClick={() => scrollBy(1)}><ChevronRightRoundedIcon /></IconButton></span></Tooltip> : null}
      {nextPage !== null ? <Button onClick={onNextPage} size="small" sx={{ flexShrink: 0 }}>次のコミット</Button> : null}
    </Stack>
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
      <Typography color="textSecondary" variant="caption">
        比較元 <Box component="span" sx={{ color: 'text.primary', fontFamily: 'code.fontFamily' }}>{showingLocal ? (headSha ? `${shortSha(headSha)}（MRの最新）` : 'MRの最新') : selected ? '親コミット' : compareFrom ? `${shortSha(compareFrom)}（過去のバージョン）` : baseSha ? shortSha(baseSha) : 'ターゲットブランチ'}</Box>
        {' → '}比較先 <Box component="span" sx={{ color: 'text.primary', fontFamily: 'code.fontFamily' }}>{showingLocal ? 'ローカルの作業ツリー' : selected ? shortSha(selected) : headSha ? shortSha(headSha) : 'MRの最新'}</Box>
      </Typography>
      {versionPicker}
      {local ? <Tooltip describeChild title="MRの最新コミットとローカルの作業ツリーの差（未pushのコミット、未コミットの変更、未追跡ファイル）を表示します。"><Button aria-pressed={showingLocal} color="inherit" onClick={local.onSelect} size="small" sx={item(showingLocal)}>ローカルの変更{local.badge}</Button></Tooltip> : null}
    </Stack>
    {selected ? <Typography color="textSecondary" role="note" variant="caption">コミット単位の表示では行コメントできません。MR全体で表示するとコメントできます。</Typography> : null}
    {showingLocal ? <Typography color="textSecondary" role="note" variant="caption">MRの最新からローカルの作業ツリーまでの変更です（未pushのコミット、未コミットの変更、未追跡ファイル）。この表示では行コメントできず、確認済みの記録にも含めません。</Typography> : null}
    {compareFrom && !selected ? <Typography color="textSecondary" role="note" variant="caption">選んだバージョンから最新までの変更です（GitLabのバージョン比較と同じく、その間にリベースがあればターゲットブランチ由来の変更も含まれます）。この表示では行コメントできず、確認済みの記録にも含めません。</Typography> : null}
  </Stack>
}

/** The linked local clone as a comparison target, with the view that shows it. */
interface LocalChoice {
  active: boolean
  /** The clone's state, read without opening the view. */
  badge?: React.ReactNode
  content: React.ReactNode
  onSelect: () => void
}

/** Chooses an earlier version (push) of the MR to show the changes since. */
function VersionPicker({ versions }: { versions: VersionChoice }) {
  // The latest version is the MR head itself, so only earlier ones are offered.
  const earlier = versions.items.filter((version) => version.headCommitSha !== versions.headSha)
  // Numbered as GitLab does (oldest is 1) when every version is listed.
  const number = (index: number) => versions.more ? null : versions.items.length - versions.items.indexOf(earlier[index])
  if (versions.error && !versions.items.length) return <Typography color="error" variant="caption">バージョンを取得できませんでした: {versions.error.message}</Typography>
  return <TextField
    disabled={versions.loading || !versions.headSha || earlier.length === 0}
    onChange={(event) => versions.onSelect(event.target.value || null)}
    select
    size="small"
    slotProps={{ htmlInput: { 'aria-label': '比較元バージョン' }, select: { displayEmpty: true } }}
    sx={{ minWidth: 220 }}
    value={versions.compareFrom ?? ''}
  >
    <MenuItem value="">{versions.loading ? 'バージョンを読み込み中…' : earlier.length === 0 ? '比較できる過去のバージョンはありません' : versions.compareFrom ? 'バージョン比較をやめる（MR全体）' : '過去のバージョンと比較…'}</MenuItem>
    {earlier.map((version, index) => {
      const at = number(index)
      return <MenuItem key={version.id} value={version.headCommitSha}>{at ? `バージョン${at} · ` : ''}{shortSha(version.headCommitSha)} · {formatVersionTime(version.createdAt)} から最新まで</MenuItem>
    })}
    {versions.more ? <MenuItem disabled value="__older">さらに古いバージョンはGitLabで確認してください</MenuItem> : null}
  </TextField>
}

function formatVersionTime(value: string): string {
  const time = Date.parse(value)
  return Number.isNaN(time) ? '日時不明' : new Intl.DateTimeFormat('ja-JP', { day: 'numeric', hour: '2-digit', minute: '2-digit', month: 'numeric' }).format(time)
}
