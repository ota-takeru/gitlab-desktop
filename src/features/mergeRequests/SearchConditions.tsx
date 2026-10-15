import Button from '@mui/material/Button'
import MenuItem from '@mui/material/MenuItem'
import MenuList from '@mui/material/MenuList'
import Popover from '@mui/material/Popover'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import { useState } from 'react'

import type { MergeRequestState } from '../../types/gitlab'
import { CONDITION_NAMES, STATE_NAMES, type ConditionKind } from './conditionNames'
import { GroupSearchPicker, ProjectSearchPicker, UserSearchPicker } from './SearchPickers'

export interface ConditionValues {
  state: MergeRequestState
  reviewer: string
  assignee: string
  authorId: string
  labels: string
  sourceBranch: string
  targetBranch: string
  updatedAfter: string
  updatedBefore: string
  projectId: string
  groupId: string
}

/**
 * Edits one condition in a popover under the tag or the add button. A choice
 * from a list applies at once; typed values apply with Enter or 「適用」.
 * `label` names the chosen person, project or group for its tag. The editor
 * renders inside the list's search form in the React tree, so its own forms
 * stop their submit from also submitting the search text.
 */
export function ConditionEditor({ anchorEl, currentUserId, groupPath, kind, onApply, onClose, values }: {
  anchorEl: HTMLElement | null
  currentUserId: string
  /** The full path of the selected group, when known. */
  groupPath?: string
  kind: ConditionKind | null
  onApply: (patch: Partial<ConditionValues>, label?: string) => void
  onClose: () => void
  values: ConditionValues
}) {
  const apply = (patch: Partial<ConditionValues>, label?: string) => {
    onApply(patch, label)
    onClose()
  }
  return <Popover
    anchorEl={anchorEl}
    anchorOrigin={{ horizontal: 'left', vertical: 'bottom' }}
    onClose={onClose}
    open={Boolean(anchorEl && kind)}
    slotProps={{ paper: { 'aria-label': kind ? `${CONDITION_NAMES[kind]}の条件` : undefined, role: 'dialog', sx: { mt: 0.5, p: kind === 'state' ? 0.5 : 1.5, width: kind === 'state' ? 200 : 360 } } }}
  >
    {kind ? <EditorBody apply={apply} currentUserId={currentUserId} groupPath={groupPath} kind={kind} values={values} /> : null}
  </Popover>
}

function EditorBody({ apply, currentUserId, groupPath, kind, values }: {
  apply: (patch: Partial<ConditionValues>, label?: string) => void
  currentUserId: string
  groupPath?: string
  kind: ConditionKind
  values: ConditionValues
}) {
  if (kind === 'state') {
    return <MenuList autoFocusItem dense>
      {(['opened', 'merged', 'closed', 'all'] as const).map((state) => <MenuItem key={state} onClick={() => apply({ state })} selected={values.state === state}>{STATE_NAMES[state]}</MenuItem>)}
    </MenuList>
  }
  if (kind === 'reviewer' || kind === 'assignee' || kind === 'author') {
    const field = kind === 'author' ? 'authorId' : kind
    const self = kind === 'author' ? currentUserId : 'self'
    const current = values[field]
    return <Stack spacing={1}>
      <UserSearchPicker
        ariaLabel={`MRの${CONDITION_NAMES[kind]}`}
        autoFocus
        label={CONDITION_NAMES[kind]}
        onChange={(id, label) => { if (id) apply({ [field]: id }, label) }}
        value={current === self ? '' : current}
      />
      <Button onClick={() => apply({ [field]: self })} sx={{ alignSelf: 'flex-start' }} variant={current === self ? 'contained' : 'outlined'}>自分</Button>
    </Stack>
  }
  if (kind === 'project') {
    return <ProjectSearchPicker ariaLabel="MRのプロジェクト" autoFocus label="プロジェクト" onChange={(id, label) => { if (id) apply({ groupId: '', projectId: id }, label) }} value={values.projectId} />
  }
  if (kind === 'group') {
    return <GroupSearchPicker ariaLabel="MRのグループ" autoFocus label="グループ" onChange={(id, fullPath) => { if (id) apply({ groupId: id, projectId: '' }, fullPath) }} selectedPath={groupPath} value={values.groupId} />
  }
  if (kind === 'updated') return <UpdatedEditor apply={apply} values={values} />
  return <TextEditor apply={apply} kind={kind} values={values} />
}

const TEXT_FIELDS = {
  labels: { field: 'labels', helper: '複数指定する場合はカンマで区切ります。' },
  sourceBranch: { field: 'sourceBranch', helper: 'ブランチ名の完全一致' },
  targetBranch: { field: 'targetBranch', helper: 'ブランチ名の完全一致' },
} as const

function TextEditor({ apply, kind, values }: { apply: (patch: Partial<ConditionValues>) => void; kind: keyof typeof TEXT_FIELDS; values: ConditionValues }) {
  const { field, helper } = TEXT_FIELDS[kind]
  const [value, setValue] = useState(values[field])
  return <Stack component="form" direction="row" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); apply({ [field]: value.trim() }) }} spacing={1} sx={{ alignItems: 'flex-start' }}>
    <TextField autoFocus fullWidth helperText={helper} label={CONDITION_NAMES[kind]} onChange={(event) => setValue(event.target.value)} slotProps={{ htmlInput: { 'aria-label': `MRの${CONDITION_NAMES[kind]}` } }} value={value} />
    <Button disabled={!value.trim()} type="submit" variant="contained">適用</Button>
  </Stack>
}

function UpdatedEditor({ apply, values }: { apply: (patch: Partial<ConditionValues>) => void; values: ConditionValues }) {
  const [after, setAfter] = useState(values.updatedAfter.slice(0, 10))
  const [before, setBefore] = useState(values.updatedBefore.slice(0, 10))
  return <Stack component="form" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); apply({ updatedAfter: after, updatedBefore: before }) }} spacing={1}>
    <Stack direction="row" spacing={1}>
      <TextField autoFocus label="開始" onChange={(event) => setAfter(event.target.value)} slotProps={{ htmlInput: { 'aria-label': 'MRの更新日（開始）' }, inputLabel: { shrink: true } }} type="date" value={after} />
      <TextField label="終了" onChange={(event) => setBefore(event.target.value)} slotProps={{ htmlInput: { 'aria-label': 'MRの更新日（終了）' }, inputLabel: { shrink: true } }} type="date" value={before} />
    </Stack>
    <Button disabled={!after && !before} sx={{ alignSelf: 'flex-end' }} type="submit" variant="contained">適用</Button>
  </Stack>
}
