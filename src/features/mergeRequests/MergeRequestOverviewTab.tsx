import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import ReplayRoundedIcon from '@mui/icons-material/ReplayRounded'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useMemo } from 'react'
import { useConfirm } from '../../components/feedbackContext'
import { MarkdownEditor } from '../../components/MarkdownEditor'
import { MockMarkdown } from '../../components/mock/MockMarkdown'
import { LabelChip } from '../../components/LabelChip'
import type { GitLabUser, LabelsQuery, MergeRequest } from '../../types/gitlab'
import { useConnection } from '../connections/connectionContext'
import { useGitLabQuery } from '../shared/useGitLabQuery'

export function OverviewTab({ approvedBy, approvalsError, approvalsLoading, description, descriptionEdit, editDisabled, mergeRequest, onCancelEdit, onChangeEdit, onRerequestReview, onSaveEdit, onStartEdit, reactions }: { approvedBy: GitLabUser[]; approvalsError: Error | null; approvalsLoading: boolean; description: string; descriptionEdit: { body: string; expected: string } | null; editDisabled: boolean; mergeRequest: MergeRequest; onCancelEdit: () => void; onChangeEdit: (body: string) => void; onRerequestReview: (user: GitLabUser) => void; onSaveEdit: () => void; onStartEdit: () => void; reactions?: React.ReactNode }) {
  const confirm = useConfirm()
  const { session } = useConnection()
  // Label colours come from the project's first page of labels; a label not on it shows without one.
  const labelsQuery = useMemo<LabelsQuery | null>(() => mergeRequest.labels?.length ? { kind: 'labels', page: 1, projectId: mergeRequest.projectId, search: '' } : null, [mergeRequest.labels?.length, mergeRequest.projectId])
  const labelColors = useGitLabQuery<LabelsQuery>(session?.id ?? null, labelsQuery)
  const canRerequest = mergeRequest.state === 'opened' && Boolean(mergeRequest.projectPath)
  const rows: Array<[string, React.ReactNode]> = [
    ['作成者', `${mergeRequest.author.name} @${mergeRequest.author.username}`],
    ['ブランチ', <Box component="span" key="branch" sx={{ fontFamily: 'code.fontFamily', fontSize: 'caption.fontSize' }}>{mergeRequest.sourceBranch} → {mergeRequest.targetBranch}</Box>],
    ['担当', mergeRequest.assignees?.length ? mergeRequest.assignees.map((user) => user.name).join('、') : 'なし'],
    ['レビュアー', mergeRequest.reviewers?.length ? <Stack component="span" key="reviewers" sx={{ alignItems: 'flex-start' }}>{mergeRequest.reviewers.map((user) => (
      <Stack component="span" direction="row" key={user.id} sx={{ alignItems: 'center', minHeight: 28 }}>
        <span>{user.name}</span>
        {canRerequest && user.id !== session?.user.id ? <Tooltip title="レビューを再依頼"><span><IconButton aria-label={`${user.name}さんにレビューを再依頼`} disabled={editDisabled} onClick={() => onRerequestReview(user)} size="small"><ReplayRoundedIcon fontSize="small" /></IconButton></span></Tooltip> : null}
      </Stack>
    ))}</Stack> : 'なし'],
    ['承認', approvalsLoading ? '承認状態を確認中…' : approvalsError ? `承認状態を利用できません: ${approvalsError.message}` : approvedBy.length ? `${approvedBy.length}人が承認済み（${approvedBy.map((user) => user.name).join('、')}）` : '未承認'],
    ['ラベル', mergeRequest.labels?.length ? <Stack direction="row" key="labels" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>{mergeRequest.labels.map((label) => <LabelChip color={labelColors.data?.find((item) => item.name === label)?.color} key={label} name={label} />)}</Stack> : 'なし'],
    ['マイルストーン', mergeRequest.milestone ? `${mergeRequest.milestone.title}${mergeRequest.milestone.dueDate ? `（期限 ${mergeRequest.milestone.dueDate}）` : ''}` : 'なし'],
  ]
  return <Box sx={{ display: 'grid', gap: 4, gridTemplateColumns: { lg: 'minmax(0, 1fr) 280px', xs: '1fr' }, maxWidth: 1200 }}>
    <Box sx={{ minWidth: 0 }}>
      <Stack direction="row" sx={{ alignItems: 'center', mb: 1 }}>
        <Typography color="textSecondary" sx={{ flex: 1 }} variant="overline">説明</Typography>
        {descriptionEdit ? null : <Button disabled={editDisabled} onClick={onStartEdit} size="small" startIcon={<EditOutlinedIcon />}>説明を編集</Button>}
      </Stack>
      {descriptionEdit ? <Stack spacing={1}>
        <MarkdownEditor autoFocus disabled={editDisabled} label="説明を編集" onChange={onChangeEdit} value={descriptionEdit.body} />
        {descriptionEdit.expected !== (description ?? '') ? <Alert severity="warning">編集中にGitLabの説明が更新されました。保存すると拒否されるので、内容を控えてから取消して開き直してください。</Alert> : null}
        <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
          <Button onClick={() => void (async () => { if (descriptionEdit.body === descriptionEdit.expected || await confirm({ cancelLabel: '編集を続ける', confirmLabel: '破棄する', destructive: true, title: '編集中の説明を破棄しますか？' })) onCancelEdit() })()}>取消</Button>
          <Button disabled={editDisabled || descriptionEdit.body === descriptionEdit.expected} onClick={onSaveEdit} variant="contained">保存</Button>
        </Stack>
      </Stack> : <MockMarkdown body={description || '説明はありません。'} />}
      {reactions ? <Box sx={{ mt: 1.5 }}>{reactions}</Box> : null}
    </Box>
    <Box component="dl" sx={{ alignContent: 'start', display: 'grid', gap: 1.5, m: 0 }}>
      {rows.map(([label, value]) => <Box key={label}><Typography color="textSecondary" component="dt" variant="caption">{label}</Typography><Typography component="dd" sx={{ m: 0, overflowWrap: 'anywhere' }} variant="body2">{value}</Typography></Box>)}
    </Box>
  </Box>
}
