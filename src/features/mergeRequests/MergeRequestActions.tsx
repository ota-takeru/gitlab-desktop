import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded'
import Alert from '@mui/material/Alert'
import Autocomplete from '@mui/material/Autocomplete'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import FormControlLabel from '@mui/material/FormControlLabel'
import IconButton from '@mui/material/IconButton'
import ListItemText from '@mui/material/ListItemText'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Radio from '@mui/material/Radio'
import RadioGroup from '@mui/material/RadioGroup'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useEffect, useId, useMemo, useRef, useState } from 'react'

import { useConfirm, useNotify } from '../../components/Feedback'
import { LabelChip } from '../../components/LabelChip'
import { PipelineStatus } from '../../components/PipelineStatus'
import { shortSha } from '../../lib/format'
import type { GitLabAction, GitLabLabel, LabelsQuery, MergeRequest, Milestone, MilestonesQuery, ProjectLookupQuery } from '../../types/gitlab'
import { useConnection } from '../connections/ConnectionProvider'
import { useGitLabQuery } from '../shared/useGitLabQuery'
import { canRebase, mergeReadiness, titleWithDraft } from './mergeActions'

/** After a rebase is accepted, the MR is read again this often while GitLab works on it. */
const REBASE_POLL_MS = 5_000
/** A rebase still running after this many reads is left to the normal refresh. */
const REBASE_POLL_LIMIT = 12

type Editor = 'merge' | 'title' | 'labels' | 'milestone' | null

export interface MergeRequestActionsProps {
  mergeRequest: MergeRequest
  /** Writes are locked or one is in flight. */
  disabled: boolean
  /** The current user is a reviewer of this MR. */
  isReviewer: boolean
  /** Sends one write and reads the MR again once it succeeded. */
  onRun: (action: GitLabAction) => Promise<boolean>
  onRefresh: () => void
}

/**
 * The MR's secondary operations in one menu beside the header's primary
 * action: merge, auto-merge, rebase, request changes, title, Draft, labels,
 * milestone and close/reopen. Each write is sent once with what the user saw,
 * so GitLab refuses it when the MR changed meanwhile.
 */
export function MergeRequestActions({ disabled, isReviewer, mergeRequest, onRefresh, onRun }: MergeRequestActionsProps) {
  const confirm = useConfirm()
  const notify = useNotify()
  const menuId = useId()
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const [editor, setEditor] = useState<Editor>(null)
  const [working, setWorking] = useState(false)
  const opened = mergeRequest.state === 'opened'
  const readiness = mergeReadiness(mergeRequest)
  const busy = disabled || working
  const ref = { iid: mergeRequest.iid, projectId: mergeRequest.projectId }

  // A rebase runs in GitLab's background; the MR is read again only while it
  // is shown and only a bounded number of times.
  const [rebasePolls, setRebasePolls] = useState<number | null>(null)
  const refreshRef = useRef(onRefresh)
  useEffect(() => { refreshRef.current = onRefresh })
  useEffect(() => {
    if (rebasePolls === null) return
    // The first read after the rebase was accepted may still show the state before it.
    const finished = rebasePolls > 0 && mergeRequest.rebaseInProgress === false
    const stop = finished || rebasePolls >= REBASE_POLL_LIMIT
    const timer = globalThis.setTimeout(() => {
      if (stop) {
        setRebasePolls(null)
        if (finished && mergeRequest.mergeError) notify({ message: `リベースできませんでした: ${mergeRequest.mergeError}`, severity: 'error' })
        else if (finished) notify({ message: 'リベースが完了しました', severity: 'success' })
        return
      }
      if (document.visibilityState === 'visible') refreshRef.current()
      setRebasePolls((count) => count === null ? null : count + 1)
    }, stop ? 0 : REBASE_POLL_MS)
    return () => globalThis.clearTimeout(timer)
  }, [mergeRequest.mergeError, mergeRequest.rebaseInProgress, notify, rebasePolls])

  const run = async (action: GitLabAction, success: string) => {
    setWorking(true)
    try {
      const ok = await onRun(action)
      if (ok) notify({ message: success, severity: 'success' })
      return ok
    } finally {
      setWorking(false)
    }
  }
  const choose = (next: () => void) => { setMenuAnchor(null); next() }

  const setState = async (stateEvent: 'close' | 'reopen') => {
    const closing = stateEvent === 'close'
    if (!await confirm({
      confirmLabel: closing ? 'クローズする' : '再オープンする',
      destructive: closing,
      message: closing ? 'MRはマージされずに閉じられます。あとで再オープンできます。' : 'MRを再びオープンにします。',
      title: `!${mergeRequest.iid} を${closing ? 'クローズ' : '再オープン'}しますか？`,
    })) return
    await run({ ...ref, kind: 'setState', stateEvent }, closing ? 'MRをクローズしました' : 'MRを再オープンしました')
  }
  const cancelAutoMerge = async () => {
    if (!await confirm({ confirmLabel: '自動マージを取り消す', message: 'パイプラインが成功してもマージされなくなります。', title: '自動マージを取り消しますか？' })) return
    await run({ ...ref, kind: 'cancelAutoMerge' }, '自動マージを取り消しました')
  }
  const rebase = async () => {
    if (!mergeRequest.headSha) return
    if (!await confirm({ confirmLabel: 'リベースする', message: `ソースブランチ ${mergeRequest.sourceBranch} を ${mergeRequest.targetBranch} の最新にリベースし、強制プッシュします。表示中のhead ${shortSha(mergeRequest.headSha)} から更新されていれば行いません。`, title: 'ソースブランチをリベースしますか？' })) return
    if (await run({ ...ref, kind: 'rebase', sha: mergeRequest.headSha }, 'リベースを開始しました。完了まで状態を確認します')) setRebasePolls(0)
  }
  const toggleDraft = async () => {
    if (!await confirm(mergeRequest.draft
      ? { confirmLabel: 'Readyにする', message: 'レビューとマージができる状態として参加者に示されます。', title: `!${mergeRequest.iid} をReadyにしますか？` }
      : { confirmLabel: 'Draftにする', message: 'Readyに戻すまでマージできなくなります。', title: `!${mergeRequest.iid} をDraftにしますか？` })) return
    await run({ ...ref, expectedTitle: mergeRequest.title, kind: 'setTitle', title: titleWithDraft(mergeRequest.title, !mergeRequest.draft) }, mergeRequest.draft ? 'Readyにしました' : 'Draftにしました')
  }
  const requestChanges = async () => {
    if (!mergeRequest.projectPath) return
    if (!await confirm({ confirmLabel: '変更を要求する', message: 'レビュアーとして、このMRに変更が必要だと示します。プロジェクトの設定によってはマージできなくなります。', title: '変更を要求しますか？' })) return
    await run({ ...ref, kind: 'requestChanges', projectPath: mergeRequest.projectPath }, '変更を要求しました')
  }

  return (
    <>
      <Tooltip title="その他の操作"><span><IconButton aria-controls={menuAnchor ? menuId : undefined} aria-expanded={menuAnchor ? 'true' : undefined} aria-haspopup="menu" aria-label="その他の操作" disabled={busy} onClick={(event) => setMenuAnchor(event.currentTarget)}><MoreVertRoundedIcon /></IconButton></span></Tooltip>
      <Menu anchorEl={menuAnchor} anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }} id={menuId} onClose={() => setMenuAnchor(null)} open={Boolean(menuAnchor)} transformOrigin={{ horizontal: 'right', vertical: 'top' }}>
        {opened ? [
          <MenuItem key="merge" onClick={() => choose(() => setEditor('merge'))}><ListItemText primary="マージ…" secondary={readiness.summary} /></MenuItem>,
          mergeRequest.autoMerge ? <MenuItem key="cancel-auto" onClick={() => choose(() => void cancelAutoMerge())}>自動マージを取り消す</MenuItem> : null,
          canRebase(mergeRequest) ? <MenuItem key="rebase" onClick={() => choose(() => void rebase())}><ListItemText primary="リベース" secondary={mergeRequest.divergedCommitsCount ? `ターゲットより${mergeRequest.divergedCommitsCount}コミット遅れています` : undefined} /></MenuItem> : null,
          <MenuItem disabled={!isReviewer || !mergeRequest.projectPath} key="request-changes" onClick={() => choose(() => void requestChanges())}><ListItemText primary="変更を要求" secondary={isReviewer ? undefined : 'レビュアーに指定されている場合に使えます'} /></MenuItem>,
          <Divider key="divider-edit" />,
        ] : null}
        <MenuItem onClick={() => choose(() => setEditor('title'))}>タイトルを編集…</MenuItem>
        {opened ? <MenuItem onClick={() => choose(() => void toggleDraft())}>{mergeRequest.draft ? 'Readyにする' : 'Draftにする'}</MenuItem> : null}
        <MenuItem onClick={() => choose(() => setEditor('labels'))}>ラベルを編集…</MenuItem>
        <MenuItem onClick={() => choose(() => setEditor('milestone'))}>マイルストーンを変更…</MenuItem>
        {mergeRequest.state === 'merged' ? null : <Divider />}
        {opened ? <MenuItem onClick={() => choose(() => void setState('close'))} sx={{ color: 'error.main' }}>MRをクローズ…</MenuItem> : null}
        {mergeRequest.state === 'closed' ? <MenuItem onClick={() => choose(() => void setState('reopen'))}>MRを再オープン…</MenuItem> : null}
      </Menu>
      {editor === 'merge' ? <MergeDialog disabled={busy} mergeRequest={mergeRequest} onClose={() => setEditor(null)} onMerge={(options) => run({ ...ref, kind: 'merge', ...options }, options.autoMerge ? '自動マージを設定しました' : 'マージしました')} /> : null}
      {editor === 'title' ? <TitleDialog disabled={busy} mergeRequest={mergeRequest} onClose={() => setEditor(null)} onSave={(title, expectedTitle) => run({ ...ref, expectedTitle, kind: 'setTitle', title }, 'タイトルを変更しました')} /> : null}
      {editor === 'labels' ? <LabelsDialog disabled={busy} mergeRequest={mergeRequest} onClose={() => setEditor(null)} onSave={(addLabels, removeLabels) => run({ ...ref, addLabels, kind: 'setLabels', removeLabels }, 'ラベルを変更しました')} /> : null}
      {editor === 'milestone' ? <MilestoneDialog disabled={busy} mergeRequest={mergeRequest} onClose={() => setEditor(null)} onSave={(milestoneId, expectedMilestoneId) => run({ ...ref, expectedMilestoneId, kind: 'setMilestone', milestoneId }, 'マイルストーンを変更しました')} /> : null}
    </>
  )
}

/** The merge state in the header's information line, for open MRs. */
export function MergeStatusText({ mergeRequest }: { mergeRequest: MergeRequest }) {
  if (mergeRequest.state !== 'opened') return null
  const readiness = mergeReadiness(mergeRequest)
  return <Typography color={readiness.tone === 'success' ? 'success' : readiness.tone === 'warning' ? 'warning' : 'textSecondary'} variant="caption">{readiness.summary}</Typography>
}

interface MergeOptions {
  sha: string
  autoMerge: boolean
  squash: boolean
  removeSourceBranch: boolean
  mergeCommitMessage?: string
}

function MergeDialog({ disabled, mergeRequest, onClose, onMerge }: { disabled: boolean; mergeRequest: MergeRequest; onClose: () => void; onMerge: (options: MergeOptions) => Promise<boolean> }) {
  const titleId = useId()
  const { session } = useConnection()
  // The head the user is shown when the dialog opens is the one merged.
  const [sha] = useState(mergeRequest.headSha)
  const readiness = mergeReadiness(mergeRequest)
  const [autoMerge, setAutoMerge] = useState(readiness.canAutoMerge)
  const [removeSourceBranch, setRemoveSourceBranch] = useState(Boolean(mergeRequest.forceRemoveSourceBranch || mergeRequest.shouldRemoveSourceBranch))
  const [squashChoice, setSquashChoice] = useState(Boolean(mergeRequest.squashOnMerge))
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const projectQuery = useMemo<ProjectLookupQuery | null>(() => mergeRequest.projectPath ? { kind: 'project', path: mergeRequest.projectPath } : null, [mergeRequest.projectPath])
  const project = useGitLabQuery<ProjectLookupQuery>(session?.id ?? null, projectQuery)
  const squashOption = project.data?.squashOption
  // GitLab applies only `squash: true`, so a squash the MR or project already asks for cannot be turned off here.
  const squashFixed = squashOption === 'always' || squashOption === 'never' || (squashOption !== undefined && mergeRequest.squashOnMerge === true)
  const squash = squashOption === 'always' ? true : squashOption === 'never' ? false : squashChoice
  const squashPending = project.loading && !project.data
  const headChanged = mergeRequest.headSha !== sha
  const allowed = autoMerge ? readiness.canAutoMerge : readiness.canMerge
  const busy = disabled || saving

  const submit = async () => {
    if (busy || !sha || headChanged || !allowed) return
    setSaving(true)
    try {
      const ok = await onMerge({ autoMerge, removeSourceBranch, sha, squash, ...(message.trim() ? { mergeCommitMessage: message } : {}) })
      if (ok) onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog aria-labelledby={titleId} fullWidth maxWidth="sm" onClose={saving ? undefined : onClose} open>
      <DialogTitle id={titleId}>!{mergeRequest.iid} をマージ</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ pt: 0.5 }}>
          <Alert severity={readiness.tone}>{readiness.summary}</Alert>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography color="textSecondary" sx={{ fontFamily: 'code.fontFamily' }} variant="caption">{mergeRequest.sourceBranch} → {mergeRequest.targetBranch}</Typography>
            {sha ? <Typography color="textSecondary" variant="caption">head {shortSha(sha)}</Typography> : null}
            {mergeRequest.pipeline ? <PipelineStatus status={mergeRequest.pipeline.status} /> : null}
          </Stack>
          {headChanged ? <Alert severity="warning">ダイアログを開いた後にMRが更新されました。閉じて内容を確認してから開き直してください。</Alert> : null}
          {readiness.canAutoMerge ? (
            <RadioGroup aria-label="マージの方法" onChange={(event) => setAutoMerge(event.target.value === 'auto')} value={autoMerge ? 'auto' : 'now'}>
              <FormControlLabel control={<Radio size="small" />} disabled={busy} label="パイプラインが成功したらマージ（自動マージ）" value="auto" />
              <FormControlLabel control={<Radio size="small" />} disabled={busy || !readiness.canMerge} label="今すぐマージ" value="now" />
            </RadioGroup>
          ) : null}
          <FormControlLabel control={<Checkbox checked={removeSourceBranch} disabled={busy} onChange={(event) => setRemoveSourceBranch(event.target.checked)} size="small" />} label="ソースブランチを削除" />
          <Stack spacing={0.25}>
            <FormControlLabel control={<Checkbox checked={squash} disabled={busy || squashFixed || squashPending} onChange={(event) => setSquashChoice(event.target.checked)} size="small" />} label="コミットをスカッシュ" />
            <Typography color="textSecondary" sx={{ pl: 4 }} variant="caption">{squashPending ? 'プロジェクトのスカッシュ設定を確認中…'
              : squashOption === 'always' ? 'プロジェクトの設定で常にスカッシュされます。'
                : squashOption === 'never' ? 'プロジェクトの設定でスカッシュしません。'
                  : squashFixed ? 'このMRはスカッシュする設定です。'
                    : project.error ? 'プロジェクトの設定を確認できないため、設定によっては選択どおりにならない場合があります。' : 'このMRのコミットを1つにまとめてマージします。'}</Typography>
          </Stack>
          <TextField disabled={busy} label="マージコミットのメッセージ（任意）" minRows={2} multiline onChange={(event) => setMessage(event.target.value)} placeholder="空欄ならGitLabの既定のメッセージ" size="small" value={message} />
          <Typography color="textSecondary" variant="caption">開いた時点のhead{sha ? ` ${shortSha(sha)}` : ''}をマージします。GitLab側で更新されていればマージしません。</Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={saving} onClick={onClose}>取消</Button>
        <Button disabled={busy || !sha || headChanged || !allowed} onClick={() => void submit()} variant="contained">{saving ? '送信中…' : autoMerge ? '自動マージを設定' : 'マージする'}</Button>
      </DialogActions>
    </Dialog>
  )
}

function TitleDialog({ disabled, mergeRequest, onClose, onSave }: { disabled: boolean; mergeRequest: MergeRequest; onClose: () => void; onSave: (title: string, expectedTitle: string) => Promise<boolean> }) {
  const titleId = useId()
  const [expected] = useState(mergeRequest.title)
  const [title, setTitle] = useState(mergeRequest.title)
  const [saving, setSaving] = useState(false)
  const trimmed = title.trim()
  const busy = disabled || saving
  const save = async () => {
    if (busy || !trimmed || trimmed === expected) return
    setSaving(true)
    try {
      if (await onSave(trimmed, expected)) onClose()
    } finally {
      setSaving(false)
    }
  }
  return (
    <Dialog aria-labelledby={titleId} fullWidth maxWidth="sm" onClose={saving ? undefined : onClose} open>
      <DialogTitle id={titleId}>タイトルを編集</DialogTitle>
      <DialogContent>
        <Stack spacing={1} sx={{ pt: 0.5 }}>
          <TextField autoFocus disabled={busy} label="タイトル" onChange={(event) => setTitle(event.target.value.replace(/[\r\n]+/gu, ' '))} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void save() } }} size="small" slotProps={{ htmlInput: { maxLength: 255 } }} value={title} />
          <Typography color="textSecondary" variant="caption">先頭に「Draft:」を付けるとDraftになります。</Typography>
          {mergeRequest.title !== expected ? <Alert severity="warning">編集中にGitLabのタイトルが更新されました。保存すると拒否されるので、内容を控えてから取消して開き直してください。</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={saving} onClick={onClose}>取消</Button>
        <Button disabled={busy || !trimmed || trimmed === expected} onClick={() => void save()} variant="contained">{saving ? '保存中…' : '保存'}</Button>
      </DialogActions>
    </Dialog>
  )
}

function useDebounced(value: string): string {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = globalThis.setTimeout(() => setDebounced(value.trim()), 350)
    return () => globalThis.clearTimeout(timer)
  }, [value])
  return debounced
}

function LabelsDialog({ disabled, mergeRequest, onClose, onSave }: { disabled: boolean; mergeRequest: MergeRequest; onClose: () => void; onSave: (add: string[], remove: string[]) => Promise<boolean> }) {
  const titleId = useId()
  const { session } = useConnection()
  // Only what the user changes from this starting point is sent.
  const [initial] = useState(() => mergeRequest.labels ?? [])
  const [selected, setSelected] = useState<string[]>(initial)
  const [searchText, setSearchText] = useState('')
  const search = useDebounced(searchText)
  const [saving, setSaving] = useState(false)
  const query = useMemo<LabelsQuery>(() => ({ kind: 'labels', page: 1, projectId: mergeRequest.projectId, search }), [mergeRequest.projectId, search])
  const result = useGitLabQuery<LabelsQuery>(session?.id ?? null, query)
  // The first unfiltered page also colours the chosen labels while a search shows others.
  const allQuery = useMemo<LabelsQuery>(() => ({ kind: 'labels', page: 1, projectId: mergeRequest.projectId, search: '' }), [mergeRequest.projectId])
  const all = useGitLabQuery<LabelsQuery>(session?.id ?? null, allQuery)
  const known = useMemo(() => new Map<string, GitLabLabel>([...all.data ?? [], ...result.data ?? []].map((label) => [label.name, label])), [all.data, result.data])
  const options = (result.data ?? []).map((label) => label.name)
  const add = selected.filter((label) => !initial.includes(label))
  const remove = initial.filter((label) => !selected.includes(label))
  const busy = disabled || saving
  const save = async () => {
    if (busy || (!add.length && !remove.length)) return
    setSaving(true)
    try {
      if (await onSave(add, remove)) onClose()
    } finally {
      setSaving(false)
    }
  }
  return (
    <Dialog aria-labelledby={titleId} fullWidth maxWidth="sm" onClose={saving ? undefined : onClose} open>
      <DialogTitle id={titleId}>ラベルを編集</DialogTitle>
      <DialogContent>
        <Stack spacing={1} sx={{ pt: 0.5 }}>
          <Autocomplete<string, true, false, false>
            disabled={busy}
            filterOptions={(available) => available}
            filterSelectedOptions
            loading={result.loading || result.refreshing}
            loadingText="検索中…"
            multiple
            noOptionsText={result.error ? 'ラベル候補を取得できませんでした' : '候補がありません'}
            onChange={(_, labels) => setSelected(labels)}
            onInputChange={(_, value, reason) => { if (reason === 'input' || reason === 'clear') setSearchText(value) }}
            options={options}
            renderInput={(params) => <TextField {...params} autoFocus label="ラベル" placeholder="ラベル名で検索" size="small" />}
            renderOption={(optionProps, name) => {
              const { key, ...rest } = optionProps
              const label = known.get(name)
              return <li key={key} {...rest}><Stack spacing={0.25} sx={{ minWidth: 0 }}><LabelChip color={label?.color} name={name} />{label?.description ? <Typography color="textSecondary" variant="caption">{label.description}</Typography> : null}</Stack></li>
            }}
            renderValue={(values, getItemProps) => values.map((name, index) => {
              const { key, ...itemProps } = getItemProps({ index })
              return <LabelChip key={key} {...itemProps} color={known.get(name)?.color} name={name} />
            })}
            value={selected}
          />
          <Typography color="textSecondary" variant="caption">追加・削除したラベルだけを送るので、他の人が同時に付けたラベルは残ります。</Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={saving} onClick={onClose}>取消</Button>
        <Button disabled={busy || (!add.length && !remove.length)} onClick={() => void save()} variant="contained">{saving ? '保存中…' : '保存'}</Button>
      </DialogActions>
    </Dialog>
  )
}

function MilestoneDialog({ disabled, mergeRequest, onClose, onSave }: { disabled: boolean; mergeRequest: MergeRequest; onClose: () => void; onSave: (milestoneId: string | null, expectedMilestoneId: string | null) => Promise<boolean> }) {
  const titleId = useId()
  const { session } = useConnection()
  const [initial] = useState<Milestone | null>(mergeRequest.milestone ?? null)
  const [selected, setSelected] = useState<Milestone | null>(initial)
  const [searchText, setSearchText] = useState('')
  const search = useDebounced(searchText)
  const [saving, setSaving] = useState(false)
  const query = useMemo<MilestonesQuery>(() => ({ kind: 'milestones', page: 1, projectId: mergeRequest.projectId, search }), [mergeRequest.projectId, search])
  const result = useGitLabQuery<MilestonesQuery>(session?.id ?? null, query)
  const options = [...(result.data ?? [])]
  // A closed milestone is not offered but can still be the current one.
  if (selected && !options.some((milestone) => milestone.id === selected.id)) options.unshift(selected)
  const unchanged = (selected?.id ?? null) === (initial?.id ?? null)
  const busy = disabled || saving
  const save = async () => {
    if (busy || unchanged) return
    setSaving(true)
    try {
      if (await onSave(selected?.id ?? null, initial?.id ?? null)) onClose()
    } finally {
      setSaving(false)
    }
  }
  return (
    <Dialog aria-labelledby={titleId} fullWidth maxWidth="sm" onClose={saving ? undefined : onClose} open>
      <DialogTitle id={titleId}>マイルストーンを変更</DialogTitle>
      <DialogContent>
        <Stack spacing={1} sx={{ pt: 0.5 }}>
          <Autocomplete<Milestone, false, false, false>
            disabled={busy}
            filterOptions={(available) => available}
            getOptionKey={(milestone) => milestone.id}
            getOptionLabel={(milestone) => milestone.title}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            loading={result.loading || result.refreshing}
            loadingText="検索中…"
            noOptionsText={result.error ? 'マイルストーン候補を取得できませんでした' : '候補がありません'}
            onChange={(_, milestone) => setSelected(milestone)}
            onInputChange={(_, value, reason) => { if (reason === 'input' || reason === 'clear') setSearchText(value) }}
            options={options}
            renderInput={(params) => <TextField {...params} autoFocus label="マイルストーン" placeholder="なし" size="small" />}
            renderOption={(optionProps, milestone) => {
              const { key, ...rest } = optionProps
              return <li key={key} {...rest}><Stack spacing={0.25} sx={{ minWidth: 0 }}><Typography variant="body2">{milestone.title}</Typography>{milestone.dueDate ? <Typography color="textSecondary" variant="caption">期限 {milestone.dueDate}</Typography> : null}</Stack></li>
            }}
            value={selected}
          />
          <Typography color="textSecondary" variant="caption">プロジェクトと上位グループの進行中のマイルストーンから選びます。空にすると外します。</Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={saving} onClick={onClose}>取消</Button>
        <Button disabled={busy || unchanged} onClick={() => void save()} variant="contained">{saving ? '保存中…' : selected ? '保存' : 'マイルストーンを外す'}</Button>
      </DialogActions>
    </Dialog>
  )
}
