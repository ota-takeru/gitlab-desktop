import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import ReplayRoundedIcon from '@mui/icons-material/ReplayRounded'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useEffect, useMemo, useRef } from 'react'
import { useConfirm } from '../../components/feedbackContext'
import { hairline } from '../../components/hairline'
import { MarkdownEditor, type MarkdownEditorHandle } from '../../components/MarkdownEditor'
import { MockMarkdown } from '../../components/mock/MockMarkdown'
import { LabelChip } from '../../components/LabelChip'
import { statusBarHeight } from '../../components/StatusBar'
import { translate } from '../../i18n/i18n'
import { useT } from '../../i18n/useT'
import type { GitLabUser, LabelsQuery, MergeRequest } from '../../types/gitlab'
import { useConnection } from '../connections/connectionContext'
import { useGitLabQuery } from '../shared/useGitLabQuery'
import { formatNames } from './mergeActions'
import { TemplateMenu } from './TemplateMenu'
import { Row } from '../../components/Row'

export function OverviewTab({ approvedBy, approvalsError, approvalsLoading, description, descriptionEdit, editDisabled, mergeRequest, onCancelEdit, onChangeEdit, onRerequestReview, onSaveEdit, onStartEdit, reactions }: { approvedBy: GitLabUser[]; approvalsError: Error | null; approvalsLoading: boolean; description: string; descriptionEdit: { body: string; expected: string } | null; editDisabled: boolean; mergeRequest: MergeRequest; onCancelEdit: () => void; onChangeEdit: (body: string) => void; onRerequestReview: (user: GitLabUser) => void; onSaveEdit: () => void; onStartEdit: () => void; reactions?: React.ReactNode }) {
  const t = useT()
  const confirm = useConfirm()
  const { session } = useConnection()
  const labels = useLabelChips(mergeRequest)
  const editorRef = useRef<MarkdownEditorHandle | null>(null)
  const canRerequest = mergeRequest.state === 'opened' && Boolean(mergeRequest.projectPath)
  const rows: Array<[string, React.ReactNode]> = [
    [t('mergeRequest.overview.author'), `${mergeRequest.author.name} @${mergeRequest.author.username}`],
    [t('mergeRequest.overview.branch'), <Box component="span" key="branch" sx={{ fontFamily: 'code.fontFamily', fontSize: 'caption.fontSize', verticalAlign: 'top' }}>{mergeRequest.sourceBranch} → {mergeRequest.targetBranch}</Box>],
    [t('mergeRequest.overview.assignees'), mergeRequest.assignees?.length ? formatNames(mergeRequest.assignees.map((user) => user.name)) : t('mergeRequest.common.none')],
    [t('mergeRequest.overview.reviewers'), mergeRequest.reviewers?.length ? <Stack component="span" key="reviewers" sx={{ alignItems: 'flex-start' }}>{mergeRequest.reviewers.map((user) => (
      <Row component="span" key={user.id}>
        <span>{user.name}</span>
        {canRerequest && user.id !== session?.user.id ? <Tooltip title={t('mergeRequest.overview.rerequestReview')}><span><IconButton aria-label={t('mergeRequest.overview.rerequestReviewFrom', { name: user.name })} disabled={editDisabled} onClick={() => onRerequestReview(user)} size="small" sx={{ my: -0.5 }}><ReplayRoundedIcon fontSize="small" /></IconButton></span></Tooltip> : null}
      </Row>
    ))}</Stack> : t('mergeRequest.common.none')],
    [t('mergeRequest.overview.approvals'), approvalsLoading ? t('mergeRequest.overview.approvalsLoading') : approvalsError ? t('mergeRequest.overview.approvalsUnavailable', { error: approvalsError.message }) : approvedBy.length ? t('mergeRequest.common.approvedBy', { count: approvedBy.length, names: formatNames(approvedBy.map((user) => user.name)) }) : t('mergeRequest.overview.notApproved')],
    [t('mergeRequest.overview.labels'), labels],
    [t('mergeRequest.overview.milestone'), milestoneText(mergeRequest)],
  ]
  return <Box sx={{ display: 'grid', gap: 4, gridTemplateColumns: { lg: 'minmax(0, 1fr) 280px', xs: '1fr' }, maxWidth: 1200 }}>
    <Box sx={{ minWidth: 0 }}>
      <Row sx={{ mb: 1 }}>
        <Typography color="textSecondary" sx={{ flex: 1 }} variant="overline">{t('mergeRequest.overview.description')}</Typography>
        {descriptionEdit ? null : <Button disabled={editDisabled} onClick={onStartEdit} size="small" startIcon={<EditOutlinedIcon />}>{t('mergeRequest.overview.editDescription')}</Button>}
      </Row>
      {descriptionEdit ? <Stack spacing={1}>
        <MarkdownEditor autoFocus disabled={editDisabled} label={t('mergeRequest.overview.editDescription')} onChange={onChangeEdit} ref={editorRef} toolbarEnd={<TemplateMenu disabled={editDisabled} onInsert={(content) => editorRef.current?.insertBlock(content)} query={{ kind: 'descriptionTemplates', projectId: mergeRequest.projectId }} />} value={descriptionEdit.body} />
        {descriptionEdit.expected !== (description ?? '') ? <Alert severity="warning">{t('mergeRequest.overview.descriptionChanged')}</Alert> : null}
        <Row spacing={1} sx={{ justifyContent: 'flex-end' }}>
          <Button onClick={() => void (async () => { if (descriptionEdit.body === descriptionEdit.expected || await confirm({ cancelLabel: t('mergeRequest.overview.discardKeepEditing'), confirmLabel: t('mergeRequest.overview.discardConfirm'), destructive: true, title: t('mergeRequest.overview.discardTitle') })) onCancelEdit() })()}>{t('mergeRequest.common.cancel')}</Button>
          <Button disabled={editDisabled || descriptionEdit.body === descriptionEdit.expected} onClick={onSaveEdit} variant="contained">{t('mergeRequest.common.save')}</Button>
        </Row>
      </Stack> : <MockMarkdown body={description || t('mergeRequest.common.descriptionEmpty')} />}
      {reactions ? <Box sx={{ mt: 1.5 }}>{reactions}</Box> : null}
    </Box>
    {/* Starts level with the 説明 label, which is centred on the 32px row of its edit button. */}
    <Box component="dl" sx={{ alignContent: 'start', display: 'grid', gap: 1.5, m: 0, pt: 1 }}>
      {rows.map(([label, value]) => <Box key={label}><Typography color="textSecondary" component="dt" variant="caption">{label}</Typography><Typography component="dd" sx={{ m: 0, overflowWrap: 'anywhere' }} variant="body2">{value}</Typography></Box>)}
    </Box>
  </Box>
}

/** The MR's labels as chips, or なし. */
function useLabelChips(mergeRequest: MergeRequest): React.ReactNode {
  const t = useT()
  const { session } = useConnection()
  // Label colours come from the project's first page of labels; a label not on it shows without one.
  const labelsQuery = useMemo<LabelsQuery | null>(() => mergeRequest.labels?.length ? { kind: 'labels', page: 1, projectId: mergeRequest.projectId, search: '' } : null, [mergeRequest.labels?.length, mergeRequest.projectId])
  const labelColors = useGitLabQuery<LabelsQuery>(session?.id ?? null, labelsQuery)
  return mergeRequest.labels?.length ? <Row key="labels" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>{mergeRequest.labels.map((label) => <LabelChip color={labelColors.data?.find((item) => item.name === label)?.color} key={label} name={label} />)}</Row> : t('mergeRequest.common.none')
}

function milestoneText(mergeRequest: MergeRequest): string {
  return mergeRequest.milestone ? mergeRequest.milestone.dueDate ? translate('mergeRequest.overview.milestoneDue', { date: mergeRequest.milestone.dueDate, title: mergeRequest.milestone.title }) : mergeRequest.milestone.title : translate('mergeRequest.common.none')
}

/**
 * The description beside the discussion, read without leaving it: a panel over
 * the right edge that leaves the threads and their scroll position as they are.
 * Esc closes it before Esc leaves the MR. Editing stays on the overview tab.
 */
export function DescriptionPanel({ description, mergeRequest, onClose, onEdit }: { description: string; mergeRequest: MergeRequest; onClose: () => void; onEdit: () => void }) {
  const t = useT()
  const labels = useLabelChips(mergeRequest)
  useEffect(() => {
    // Capture runs before the app's Esc, which would return to the list.
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('[role="dialog"]')) return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', close, true)
    return () => window.removeEventListener('keydown', close, true)
  }, [onClose])
  return (
    <Box aria-label={t('mergeRequest.overview.descriptionPanel')} component="aside" sx={{ bgcolor: 'background.paper', ...hairline('left', { position: false }), bottom: statusBarHeight, boxShadow: 8, display: 'flex', flexDirection: 'column', position: 'fixed', right: 0, top: 'var(--detail-header-height, 0px)', width: 'min(520px, 50vw)', zIndex: 'drawer' }}>
      <Row spacing={0.5} sx={{ ...hairline('bottom'), flexShrink: 0, pl: 2, pr: 0.5, py: 0.5 }}>
        <Typography color="textSecondary" sx={{ flex: 1 }} variant="overline">{t('mergeRequest.overview.description')}</Typography>
        <Button onClick={onEdit} size="small" startIcon={<EditOutlinedIcon />}>{t('mergeRequest.overview.editInOverview')}</Button>
        <Tooltip title={t('mergeRequest.common.closeEsc')}><IconButton aria-label={t('mergeRequest.overview.closeDescription')} onClick={onClose}><CloseRoundedIcon /></IconButton></Tooltip>
      </Row>
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 2, py: 1.5 }}>
        <MockMarkdown body={description || t('mergeRequest.common.descriptionEmpty')} />
        <Box component="dl" sx={{ display: 'grid', gap: 1.5, mb: 0, mt: 3 }}>
          {([[t('mergeRequest.overview.labels'), labels], [t('mergeRequest.overview.milestone'), milestoneText(mergeRequest)]] as const).map(([label, value]) => <Box key={label}><Typography color="textSecondary" component="dt" variant="caption">{label}</Typography><Typography component="dd" sx={{ m: 0, overflowWrap: 'anywhere' }} variant="body2">{value}</Typography></Box>)}
        </Box>
      </Box>
    </Box>
  )
}
