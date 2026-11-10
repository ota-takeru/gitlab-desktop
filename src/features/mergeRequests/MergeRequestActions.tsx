import CallMergeRoundedIcon from '@mui/icons-material/CallMergeRounded'
import CheckCircleOutlineRoundedIcon from '@mui/icons-material/CheckCircleOutlineRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import Alert from '@mui/material/Alert'
import Autocomplete from '@mui/material/Autocomplete'
import Button from '@mui/material/Button'
import ButtonBase from '@mui/material/ButtonBase'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import ListItemText from '@mui/material/ListItemText'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { memo, useEffect, useId, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react'

import { useConfirm, useNotify } from '../../components/feedbackContext'
import { LabelChip } from '../../components/LabelChip'
import { StateIcon } from '../../components/StateIcon'
import { useT } from '../../i18n/useT'
import { shortSha } from '../../lib/format'
import type { GitLabAction, GitLabLabel, LabelsQuery, MergeRequest, Milestone, MilestonesQuery } from '../../types/gitlab'
import { useConnection } from '../connections/connectionContext'
import { useGitLabQuery } from '../shared/useGitLabQuery'
import { canRebase, mergeReadiness, titleWithDraft } from './mergeActions'

/** After a rebase is accepted, the MR is read again this often while GitLab works on it. */
const REBASE_POLL_MS = 5_000
/** A rebase still running after this many reads is left to the normal refresh. */
const REBASE_POLL_LIMIT = 12

type Editor = 'title' | 'labels' | 'milestone' | null

export interface MergeOptions {
  sha: string
  autoMerge: boolean
  squash: boolean
  removeSourceBranch: boolean
  mergeCommitMessage?: string
}

/** The writes the merge panel runs here, where they stay mounted on every tab. */
export interface MergeRequestActionsHandle {
  cancelAutoMerge: () => Promise<void>
  merge: (options: MergeOptions) => Promise<boolean>
  rebase: () => Promise<void>
  toggleDraft: () => Promise<void>
}

export interface MergeRequestActionsProps {
  mergeRequest: MergeRequest
  /** Writes are locked or one is in flight. */
  disabled: boolean
  /** The current user is a reviewer of this MR. */
  isReviewer: boolean
  /** The merge is the header's one primary action, rather than the approval. */
  mergePrimary: boolean
  /** Brings the merge panel into view. */
  onOpenMerge: () => void
  ref?: Ref<MergeRequestActionsHandle>
  /** Sends one write and reads the MR again once it succeeded. */
  onRun: (action: GitLabAction) => Promise<boolean>
  onRefresh: () => void
}

/**
 * The MR's operations beside the header's approve button: request changes and
 * the step that moves the MR on (the way to the merge panel, cancelling auto-merge, rebase or reopen) as
 * buttons, then a menu for rebase on demand, title, Draft, labels, milestone
 * and close. Each write is sent once with what the user saw, so GitLab refuses
 * it when the MR changed meanwhile.
 */
/** Memoized: the MR page renders on every file or tab switch, the actions only when the MR or the lock changes. */
export const MergeRequestActions = memo(function MergeRequestActions({ disabled, isReviewer, mergePrimary, mergeRequest, onOpenMerge, onRefresh, onRun, ref }: MergeRequestActionsProps) {
  const t = useT()
  const confirm = useConfirm()
  const notify = useNotify()
  const menuId = useId()
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const [editor, setEditor] = useState<Editor>(null)
  const [working, setWorking] = useState(false)
  const opened = mergeRequest.state === 'opened'
  const readiness = mergeReadiness(mergeRequest)
  const busy = disabled || working
  const target = { iid: mergeRequest.iid, projectId: mergeRequest.projectId }

  // A rebase runs in GitLab's background; the MR is read again only while it
  // is shown and only a bounded number of times.
  const [rebasePolls, setRebasePolls] = useState<number | null>(null)
  const refreshRef = useRef(onRefresh)
  const latestHeadRef = useRef(mergeRequest.headSha)
  useEffect(() => { refreshRef.current = onRefresh; latestHeadRef.current = mergeRequest.headSha })
  useEffect(() => {
    if (rebasePolls === null) return
    // The first read after the rebase was accepted may still show the state before it.
    const finished = rebasePolls > 0 && mergeRequest.rebaseInProgress === false
    const stop = finished || rebasePolls >= REBASE_POLL_LIMIT
    const timer = globalThis.setTimeout(() => {
      if (stop) {
        setRebasePolls(null)
        if (finished && mergeRequest.mergeError) notify({ message: t('mergeRequest.rebase.failed', { error: mergeRequest.mergeError }), severity: 'error' })
        else if (finished) notify({ message: t('mergeRequest.rebase.done'), severity: 'success' })
        return
      }
      if (document.visibilityState === 'visible') refreshRef.current()
      setRebasePolls((count) => count === null ? null : count + 1)
    }, stop ? 0 : REBASE_POLL_MS)
    return () => globalThis.clearTimeout(timer)
  }, [mergeRequest.mergeError, mergeRequest.rebaseInProgress, notify, rebasePolls, t])

  const run = async (action: GitLabAction, success: string, celebrate = false) => {
    setWorking(true)
    try {
      const ok = await onRun(action)
      if (ok) notify({ celebrate, message: success, severity: 'success' })
      return ok
    } finally {
      setWorking(false)
    }
  }
  const choose = (next: () => void) => { setMenuAnchor(null); next() }

  const setState = async (stateEvent: 'close' | 'reopen') => {
    const closing = stateEvent === 'close'
    if (!await confirm({
      confirmLabel: closing ? t('mergeRequest.state.closeConfirm') : t('mergeRequest.state.reopenConfirm'),
      destructive: closing,
      message: closing ? t('mergeRequest.state.closeMessage') : t('mergeRequest.state.reopenMessage'),
      title: closing ? t('mergeRequest.state.closeTitle', { iid: mergeRequest.iid }) : t('mergeRequest.state.reopenTitle', { iid: mergeRequest.iid }),
    })) return
    await run({ ...target, kind: 'setState', stateEvent }, closing ? t('mergeRequest.state.closed') : t('mergeRequest.state.reopened'))
  }
  const cancelAutoMerge = async () => {
    if (!await confirm({ confirmLabel: t('mergeRequest.autoMerge.cancel'), message: t('mergeRequest.autoMerge.cancelMessage'), title: t('mergeRequest.autoMerge.cancelTitle') })) return
    await run({ ...target, kind: 'cancelAutoMerge' }, t('mergeRequest.autoMerge.canceled'))
  }
  const rebase = async () => {
    if (!mergeRequest.headSha) return
    if (!await confirm({ confirmLabel: t('mergeRequest.rebase.confirm'), message: t('mergeRequest.rebase.message', { sha: shortSha(mergeRequest.headSha), source: mergeRequest.sourceBranch, target: mergeRequest.targetBranch }), title: t('mergeRequest.rebase.title') })) return
    if (await run({ ...target, kind: 'rebase', sha: mergeRequest.headSha }, t('mergeRequest.rebase.started'))) setRebasePolls(0)
  }
  const toggleDraft = async () => {
    if (!await confirm(mergeRequest.draft
      ? { confirmLabel: t('mergeRequest.draft.markReady'), message: t('mergeRequest.draft.readyMessage'), title: t('mergeRequest.draft.readyTitle', { iid: mergeRequest.iid }) }
      : { confirmLabel: t('mergeRequest.draft.markDraft'), message: t('mergeRequest.draft.draftMessage'), title: t('mergeRequest.draft.draftTitle', { iid: mergeRequest.iid }) })) return
    await run({ ...target, expectedTitle: mergeRequest.title, kind: 'setTitle', title: titleWithDraft(mergeRequest.title, !mergeRequest.draft) }, mergeRequest.draft ? t('mergeRequest.draft.markedReady') : t('mergeRequest.draft.markedDraft'))
  }
  const requestChanges = async () => {
    if (!mergeRequest.projectPath) return
    if (!await confirm({ confirmLabel: t('mergeRequest.requestChanges.confirm'), message: t('mergeRequest.requestChanges.message'), title: t('mergeRequest.requestChanges.title') })) return
    await run({ ...target, kind: 'requestChanges', projectPath: mergeRequest.projectPath }, t('mergeRequest.requestChanges.done'))
  }

  const merge = async (options: MergeOptions) => {
    const noted = [options.removeSourceBranch ? t('mergeRequest.mergeDialog.removeSourceBranch') : null, options.squash ? t('mergeRequest.mergeDialog.squash') : null].filter((label) => label !== null)
    if (!await confirm({
      confirmLabel: options.autoMerge ? t('mergeRequest.mergeDialog.submitAuto') : t('mergeRequest.mergeDialog.submit'),
      message: [`${mergeRequest.sourceBranch} → ${mergeRequest.targetBranch}`, t('mergeRequest.mergeDialog.headNote', { sha: shortSha(options.sha) }), ...noted].map((line) => <div key={line}>{line}</div>),
      title: t('mergeRequest.mergeDialog.title', { iid: mergeRequest.iid }),
    })) return false
    // A head that moved while the confirmation was open is not the one the user just agreed to.
    if (latestHeadRef.current !== options.sha) {
      notify({ message: t('mergeRequest.mergePanel.headChanged'), severity: 'warning' })
      return false
    }
    const ok = await run({ ...target, kind: 'merge', ...options }, options.autoMerge ? t('mergeRequest.mergeDialog.autoMergeSet') : t('mergeRequest.mergeDialog.merged'), !options.autoMerge)
    // A refused merge means what was shown is out of date; the panel then shows why from GitLab's current state.
    if (!ok) refreshRef.current()
    return ok
  }
  useImperativeHandle(ref, () => ({ cancelAutoMerge, merge, rebase, toggleDraft }))

  // The one step that moves this MR on is a button; while a rebase is what blocks the merge, that step is the rebase.
  const needsRebase = canRebase(mergeRequest) && mergeRequest.detailedMergeStatus === 'need_rebase'
  const nextStep = mergeRequest.state === 'closed' ? <Button disabled={busy} onClick={() => void setState('reopen')} variant="outlined">{t('mergeRequest.menu.reopen')}</Button>
    : !opened ? null
      : mergeRequest.autoMerge ? <Button disabled={busy} onClick={() => void cancelAutoMerge()} variant="outlined">{t('mergeRequest.autoMerge.cancel')}</Button>
        : needsRebase ? <Button disabled={busy} onClick={() => void rebase()} variant="outlined">{t('mergeRequest.menu.rebase')}</Button>
          : <Button disabled={busy} onClick={onOpenMerge} startIcon={<CallMergeRoundedIcon />} variant={mergePrimary ? 'contained' : 'outlined'}>{readiness.canAutoMerge ? t('mergeRequest.mergeDialog.submitAuto') : t('mergeRequest.menu.merge')}</Button>

  return (
    <>
      {opened && isReviewer ? <Button disabled={busy || !mergeRequest.projectPath} onClick={() => void requestChanges()} variant="outlined">{t('mergeRequest.menu.requestChanges')}</Button> : null}
      {nextStep ? <Tooltip describeChild title={opened ? readiness.summary : ''}><span>{nextStep}</span></Tooltip> : null}
      <Button aria-controls={menuAnchor ? menuId : undefined} aria-expanded={menuAnchor ? 'true' : undefined} aria-haspopup="menu" color="inherit" disabled={busy} endIcon={<ExpandMoreRoundedIcon />} onClick={(event) => setMenuAnchor(event.currentTarget)}>{t('mergeRequest.menu.more')}</Button>
      <Menu anchorEl={menuAnchor} anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }} id={menuId} onClose={() => setMenuAnchor(null)} open={Boolean(menuAnchor)} transformOrigin={{ horizontal: 'right', vertical: 'top' }}>
        {canRebase(mergeRequest) && !needsRebase ? [
          <MenuItem key="rebase" onClick={() => choose(() => void rebase())}><ListItemText primary={t('mergeRequest.menu.rebase')} secondary={mergeRequest.divergedCommitsCount ? t('mergeRequest.menu.behind', { count: mergeRequest.divergedCommitsCount }) : undefined} /></MenuItem>,
          <Divider key="divider-edit" />,
        ] : null}
        <MenuItem onClick={() => choose(() => setEditor('title'))}>{t('mergeRequest.menu.editTitle')}</MenuItem>
        {opened ? <MenuItem onClick={() => choose(() => void toggleDraft())}>{mergeRequest.draft ? t('mergeRequest.draft.markReady') : t('mergeRequest.draft.markDraft')}</MenuItem> : null}
        <MenuItem onClick={() => choose(() => setEditor('labels'))}>{t('mergeRequest.menu.editLabels')}</MenuItem>
        <MenuItem onClick={() => choose(() => setEditor('milestone'))}>{t('mergeRequest.menu.changeMilestone')}</MenuItem>
        {opened ? <Divider /> : null}
        {opened ? <MenuItem onClick={() => choose(() => void setState('close'))} sx={{ color: 'error.main' }}>{t('mergeRequest.menu.close')}</MenuItem> : null}
      </Menu>
      {editor === 'title' ? <TitleDialog disabled={busy} mergeRequest={mergeRequest} onClose={() => setEditor(null)} onSave={(title, expectedTitle) => run({ ...target, expectedTitle, kind: 'setTitle', title }, t('mergeRequest.titleDialog.saved'))} /> : null}
      {editor === 'labels' ? <LabelsDialog disabled={busy} mergeRequest={mergeRequest} onClose={() => setEditor(null)} onSave={(addLabels, removeLabels) => run({ ...target, addLabels, kind: 'setLabels', removeLabels }, t('mergeRequest.labelsDialog.saved'))} /> : null}
      {editor === 'milestone' ? <MilestoneDialog disabled={busy} mergeRequest={mergeRequest} onClose={() => setEditor(null)} onSave={(milestoneId, expectedMilestoneId) => run({ ...target, expectedMilestoneId, kind: 'setMilestone', milestoneId }, t('mergeRequest.milestoneDialog.saved'))} /> : null}
    </>
  )
})

/** The merge state in the header's information line, for open MRs. */
export function MergeStatusText({ mergeRequest, onOpen }: { mergeRequest: MergeRequest; onOpen: () => void }) {
  if (mergeRequest.state !== 'opened') return null
  const readiness = mergeReadiness(mergeRequest)
  const icon = readiness.tone === 'success' ? <CheckCircleOutlineRoundedIcon fontSize="inherit" /> : readiness.tone === 'warning' ? <WarningAmberRoundedIcon fontSize="inherit" /> : <InfoOutlinedIcon fontSize="inherit" />
  // The icon tells mergeable, blocked and waiting apart at a glance; the reason is the tooltip, and the panel says what to do.
  return <ButtonBase aria-label={readiness.summary} onClick={onOpen} sx={{ borderRadius: 1 }}><StateIcon icon={icon} label={readiness.summary} tone={readiness.tone === 'success' ? 'success' : readiness.tone === 'warning' ? 'warning' : 'neutral'} /></ButtonBase>
}

function TitleDialog({ disabled, mergeRequest, onClose, onSave }: { disabled: boolean; mergeRequest: MergeRequest; onClose: () => void; onSave: (title: string, expectedTitle: string) => Promise<boolean> }) {
  const t = useT()
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
      <DialogTitle id={titleId}>{t('mergeRequest.titleDialog.title')}</DialogTitle>
      <DialogContent>
        <Stack spacing={1} sx={{ pt: 0.5 }}>
          <TextField autoFocus disabled={busy} label={t('mergeRequest.titleDialog.label')} onChange={(event) => setTitle(event.target.value.replace(/[\r\n]+/gu, ' '))} onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void save() } }} size="small" slotProps={{ htmlInput: { maxLength: 255 } }} value={title} />
          <Typography color="textSecondary" variant="caption">{t('mergeRequest.titleDialog.draftHint')}</Typography>
          {mergeRequest.title !== expected ? <Alert severity="warning">{t('mergeRequest.titleDialog.changed')}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={saving} onClick={onClose}>{t('mergeRequest.common.cancel')}</Button>
        <Button disabled={busy || !trimmed || trimmed === expected} onClick={() => void save()} variant="contained">{saving ? t('mergeRequest.common.saving') : t('mergeRequest.common.save')}</Button>
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
  const t = useT()
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
      <DialogTitle id={titleId}>{t('mergeRequest.labelsDialog.title')}</DialogTitle>
      <DialogContent>
        <Stack spacing={1} sx={{ pt: 0.5 }}>
          <Autocomplete<string, true, false, false>
            disabled={busy}
            filterOptions={(available) => available}
            filterSelectedOptions
            loading={result.loading || result.refreshing}
            loadingText={t('mergeRequest.common.searching')}
            multiple
            noOptionsText={result.error ? t('mergeRequest.labelsDialog.loadFailed') : t('mergeRequest.common.noOptions')}
            onChange={(_, labels) => setSelected(labels)}
            onInputChange={(_, value, reason) => { if (reason === 'input' || reason === 'clear') setSearchText(value) }}
            options={options}
            renderInput={(params) => <TextField {...params} autoFocus label={t('mergeRequest.labelsDialog.label')} placeholder={t('mergeRequest.labelsDialog.placeholder')} size="small" />}
            renderOption={(optionProps, name) => {
              const { key, ...rest } = optionProps
              const label = known.get(name)
              return <li key={key} {...rest}><Stack sx={{ minWidth: 0 }}><LabelChip color={label?.color} name={name} />{label?.description ? <Typography color="textSecondary" variant="caption">{label.description}</Typography> : null}</Stack></li>
            }}
            renderValue={(values, getItemProps) => values.map((name, index) => {
              const { key, ...itemProps } = getItemProps({ index })
              return <LabelChip key={key} {...itemProps} color={known.get(name)?.color} name={name} />
            })}
            value={selected}
          />
          <Typography color="textSecondary" variant="caption">{t('mergeRequest.labelsDialog.hint')}</Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={saving} onClick={onClose}>{t('mergeRequest.common.cancel')}</Button>
        <Button disabled={busy || (!add.length && !remove.length)} onClick={() => void save()} variant="contained">{saving ? t('mergeRequest.common.saving') : t('mergeRequest.common.save')}</Button>
      </DialogActions>
    </Dialog>
  )
}

function MilestoneDialog({ disabled, mergeRequest, onClose, onSave }: { disabled: boolean; mergeRequest: MergeRequest; onClose: () => void; onSave: (milestoneId: string | null, expectedMilestoneId: string | null) => Promise<boolean> }) {
  const t = useT()
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
      <DialogTitle id={titleId}>{t('mergeRequest.milestoneDialog.title')}</DialogTitle>
      <DialogContent>
        <Stack spacing={1} sx={{ pt: 0.5 }}>
          <Autocomplete<Milestone, false, false, false>
            disabled={busy}
            filterOptions={(available) => available}
            getOptionKey={(milestone) => milestone.id}
            getOptionLabel={(milestone) => milestone.title}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            loading={result.loading || result.refreshing}
            loadingText={t('mergeRequest.common.searching')}
            noOptionsText={result.error ? t('mergeRequest.milestoneDialog.loadFailed') : t('mergeRequest.common.noOptions')}
            onChange={(_, milestone) => setSelected(milestone)}
            onInputChange={(_, value, reason) => { if (reason === 'input' || reason === 'clear') setSearchText(value) }}
            options={options}
            renderInput={(params) => <TextField {...params} autoFocus label={t('mergeRequest.milestoneDialog.label')} placeholder={t('mergeRequest.common.none')} size="small" />}
            renderOption={(optionProps, milestone) => {
              const { key, ...rest } = optionProps
              return <li key={key} {...rest}><Stack sx={{ minWidth: 0 }}><Typography variant="body2">{milestone.title}</Typography>{milestone.dueDate ? <Typography color="textSecondary" variant="caption">{t('mergeRequest.milestoneDialog.due', { date: milestone.dueDate })}</Typography> : null}</Stack></li>
            }}
            value={selected}
          />
          <Typography color="textSecondary" variant="caption">{t('mergeRequest.milestoneDialog.hint')}</Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={saving} onClick={onClose}>{t('mergeRequest.common.cancel')}</Button>
        <Button disabled={busy || unchanged} onClick={() => void save()} variant="contained">{saving ? t('mergeRequest.common.saving') : selected ? t('mergeRequest.common.save') : t('mergeRequest.milestoneDialog.remove')}</Button>
      </DialogActions>
    </Dialog>
  )
}
