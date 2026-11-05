import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import FormControlLabel from '@mui/material/FormControlLabel'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useEffect, useMemo, useRef, useState } from 'react'

import { panelFrame } from '../../components/hairline'
import { Row } from '../../components/Row'
import { useT } from '../../i18n/useT'
import type { MergeRequest, ProjectLookupQuery } from '../../types/gitlab'
import { useConnection } from '../connections/connectionContext'
import { useGitLabQuery } from '../shared/useGitLabQuery'
import { canRebase, mergeReadiness, mergeResolution, type MergeResolution } from './mergeActions'
import type { MergeOptions } from './MergeRequestActions'

export interface MergePanelProps {
  /** Writes are locked or one is in flight. */
  disabled: boolean
  /** The current user may approve now; the approve step is offered only then. */
  canApprove: boolean
  /** The header asked to bring the panel into view. */
  focusRequested: boolean
  mergeRequest: MergeRequest
  onCancelAutoMerge: () => void
  onFocused: () => void
  onMerge: (options: MergeOptions) => Promise<boolean>
  onResolve: (resolution: MergeResolution) => void
}

/**
 * Whether an open MR can merge, the step that gets it there, and the merge
 * itself with its options, at the top of the overview. The head sent is the one
 * shown when the merge is pressed.
 */
export function MergePanel({ canApprove, disabled, focusRequested, mergeRequest, onCancelAutoMerge, onFocused, onMerge, onResolve }: MergePanelProps) {
  const t = useT()
  const { session } = useConnection()
  const rootRef = useRef<HTMLElement | null>(null)
  const readiness = mergeReadiness(mergeRequest)
  const resolution = mergeResolution(mergeRequest)
  const [removeSourceBranch, setRemoveSourceBranch] = useState(Boolean(mergeRequest.forceRemoveSourceBranch || mergeRequest.shouldRemoveSourceBranch))
  const [squashChoice, setSquashChoice] = useState(Boolean(mergeRequest.squashOnMerge))
  const [editMessage, setEditMessage] = useState(false)
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const projectQuery = useMemo<ProjectLookupQuery | null>(() => mergeRequest.projectPath ? { kind: 'project', path: mergeRequest.projectPath } : null, [mergeRequest.projectPath])
  const project = useGitLabQuery<ProjectLookupQuery>(session?.id ?? null, projectQuery)
  const squashOption = project.data?.squashOption
  // GitLab applies only `squash: true`, so a squash the MR or project already asks for cannot be turned off here.
  const squashFixed = squashOption === 'always' || squashOption === 'never' || (squashOption !== undefined && mergeRequest.squashOnMerge === true)
  const squash = squashOption === 'always' ? true : squashOption === 'never' ? false : squashChoice
  const squashPending = project.loading && !project.data
  const busy = disabled || sending
  // A required rebase is already the step beside the status.
  const showBehind = canRebase(mergeRequest) && mergeRequest.detailedMergeStatus !== 'need_rebase' && (mergeRequest.divergedCommitsCount ?? 0) > 0
  const showOptions = mergeRequest.canMerge === true && !mergeRequest.autoMerge

  useEffect(() => {
    if (!focusRequested) return
    rootRef.current?.scrollIntoView?.({ block: 'start' })
    rootRef.current?.focus({ preventScroll: true })
    onFocused()
  }, [focusRequested, onFocused])

  const submit = async (autoMerge: boolean) => {
    const sha = mergeRequest.headSha
    if (busy || !sha) return
    setSending(true)
    try {
      await onMerge({ autoMerge, removeSourceBranch, sha, squash, ...(editMessage && message.trim() ? { mergeCommitMessage: message } : {}) })
    } finally {
      setSending(false)
    }
  }

  const resolutionLabel: Record<MergeResolution, string> = {
    approve: t('mergeRequest.approval.approve'),
    markReady: t('mergeRequest.draft.markReady'),
    openDiscussion: t('mergeRequest.mergePanel.openDiscussion'),
    openInGitLab: t('mergeRequest.common.openInGitLab'),
    openPipelines: t('mergeRequest.mergePanel.openPipelines'),
    rebase: t('mergeRequest.menu.rebase'),
  }
  const showResolution = resolution !== null && (resolution !== 'approve' || canApprove) && (resolution !== 'rebase' || canRebase(mergeRequest))
  const statusAction = mergeRequest.autoMerge
    ? <Button color="inherit" disabled={busy} onClick={onCancelAutoMerge} size="small">{t('mergeRequest.autoMerge.cancel')}</Button>
    : showResolution
      // Going to another tab or to GitLab writes nothing, so a locked client still offers it.
      ? <Button color="inherit" disabled={busy && (resolution === 'approve' || resolution === 'markReady' || resolution === 'rebase')} onClick={() => onResolve(resolution)} size="small">{resolutionLabel[resolution]}</Button>
      : undefined

  return (
    <Box aria-label={t('mergeRequest.mergePanel.title')} component="section" ref={rootRef} sx={{ ...panelFrame(), borderRadius: 1, maxWidth: 1200, mb: 2, outline: 'none', p: 1.5, scrollMarginTop: 'calc(var(--detail-header-height, 0px) + 16px)' }} tabIndex={-1}>
      <Stack spacing={1}>
        <Alert action={statusAction} severity={readiness.tone}>{readiness.summary}</Alert>
        {showBehind ? <Row spacing={1}>
          <Typography color="textSecondary" variant="body2">{t('mergeRequest.menu.behind', { count: mergeRequest.divergedCommitsCount ?? 0 })}</Typography>
          <Button disabled={busy} onClick={() => onResolve('rebase')} size="small">{t('mergeRequest.menu.rebase')}</Button>
        </Row> : null}
        {showOptions ? <>
          <Row sx={{ columnGap: 2, flexWrap: 'wrap' }}>
            <FormControlLabel control={<Checkbox checked={removeSourceBranch} disabled={busy} onChange={(event) => setRemoveSourceBranch(event.target.checked)} size="small" />} label={t('mergeRequest.mergeDialog.removeSourceBranch')} />
            <FormControlLabel control={<Checkbox checked={squash} disabled={busy || squashFixed || squashPending} onChange={(event) => setSquashChoice(event.target.checked)} size="small" />} label={t('mergeRequest.mergeDialog.squash')} />
            <FormControlLabel control={<Checkbox checked={editMessage} disabled={busy} onChange={(event) => setEditMessage(event.target.checked)} size="small" />} label={t('mergeRequest.mergePanel.editMessage')} />
          </Row>
          <Typography color="textSecondary" variant="caption">{squashPending ? t('mergeRequest.mergeDialog.squashChecking')
            : squashOption === 'always' ? t('mergeRequest.mergeDialog.squashAlways')
              : squashOption === 'never' ? t('mergeRequest.mergeDialog.squashNever')
                : squashFixed ? t('mergeRequest.mergeDialog.squashRequested')
                  : project.error ? t('mergeRequest.mergeDialog.squashUnknown') : t('mergeRequest.mergeDialog.squashHint')}</Typography>
          {editMessage ? <TextField disabled={busy} label={t('mergeRequest.mergeDialog.message')} minRows={2} multiline onChange={(event) => setMessage(event.target.value)} placeholder={t('mergeRequest.mergeDialog.messagePlaceholder')} size="small" value={message} /> : null}
          <Row spacing={1} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
            {readiness.canAutoMerge ? <>
              <Button disabled={busy || !mergeRequest.headSha} onClick={() => void submit(true)} variant="contained">{t('mergeRequest.mergeDialog.submitAuto')}</Button>
              {readiness.canMerge ? <Button disabled={busy || !mergeRequest.headSha} onClick={() => void submit(false)} variant="outlined">{t('mergeRequest.mergeDialog.now')}</Button> : null}
              <Typography color="textSecondary" variant="caption">{t('mergeRequest.mergeDialog.auto')}</Typography>
            </> : <Button disabled={busy || !mergeRequest.headSha || !readiness.canMerge} onClick={() => void submit(false)} variant="contained">{t('mergeRequest.mergeDialog.submit')}</Button>}
          </Row>
        </> : null}
      </Stack>
    </Box>
  )
}
