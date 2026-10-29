import Button from '@mui/material/Button'
import MenuItem from '@mui/material/MenuItem'
import MenuList from '@mui/material/MenuList'
import Popover from '@mui/material/Popover'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import { useState } from 'react'

import { useT } from '../../i18n/useT'
import type { MergeRequestState } from '../../types/gitlab'
import { CONDITION_NAMES, STATE_NAMES, type ConditionKind } from './conditionNames'
import { GroupSearchPicker, ProjectSearchPicker, UserSearchPicker } from './SearchPickers'
import { Row } from '../../components/Row'

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
export function ConditionEditor({ anchorEl, currentUserId, groupPath, kind, nameOf, onApply, onClose, values }: {
  anchorEl: HTMLElement | null
  currentUserId: string
  /** The full path of the selected group, when known. */
  groupPath?: string
  kind: ConditionKind | null
  /** The name of the chosen person or project, when known. */
  nameOf?: (kind: 'reviewer' | 'assignee' | 'author' | 'project', id: string) => string | undefined
  onApply: (patch: Partial<ConditionValues>, label?: string) => void
  onClose: () => void
  values: ConditionValues
}) {
  const t = useT()
  const apply = (patch: Partial<ConditionValues>, label?: string) => {
    onApply(patch, label)
    onClose()
  }
  return <Popover
    anchorEl={anchorEl}
    anchorOrigin={{ horizontal: 'left', vertical: 'bottom' }}
    onClose={onClose}
    open={Boolean(anchorEl && kind)}
    slotProps={{ paper: { 'aria-label': kind ? t('mrList.editor.dialog', { condition: t(CONDITION_NAMES[kind]) }) : undefined, role: 'dialog', sx: { mt: 0.5, p: kind === 'state' ? 0.5 : 1.5, width: kind === 'state' ? 200 : 360 } } }}
  >
    {kind ? <EditorBody apply={apply} currentUserId={currentUserId} groupPath={groupPath} kind={kind} nameOf={nameOf} values={values} /> : null}
  </Popover>
}

function EditorBody({ apply, currentUserId, groupPath, kind, nameOf, values }: {
  apply: (patch: Partial<ConditionValues>, label?: string) => void
  currentUserId: string
  groupPath?: string
  kind: ConditionKind
  nameOf?: (kind: 'reviewer' | 'assignee' | 'author' | 'project', id: string) => string | undefined
  values: ConditionValues
}) {
  const t = useT()
  if (kind === 'state') {
    return <MenuList autoFocusItem dense>
      {(['opened', 'merged', 'closed', 'all'] as const).map((state) => <MenuItem key={state} onClick={() => apply({ state })} selected={values.state === state}>{t(STATE_NAMES[state])}</MenuItem>)}
    </MenuList>
  }
  if (kind === 'reviewer' || kind === 'assignee' || kind === 'author') {
    const field = kind === 'author' ? 'authorId' : kind
    const self = kind === 'author' ? currentUserId : 'self'
    const current = values[field]
    return <Stack spacing={1}>
      <UserSearchPicker
        ariaLabel={t('mrList.editor.field', { condition: t(CONDITION_NAMES[kind]) })}
        autoFocus
        label={t(CONDITION_NAMES[kind])}
        onChange={(id, label) => { if (id) apply({ [field]: id }, label) }}
        selectedName={current && current !== self ? nameOf?.(kind, current) : undefined}
        value={current === self ? '' : current}
      />
      <Button onClick={() => apply({ [field]: self })} sx={{ alignSelf: 'flex-start' }} variant={current === self ? 'contained' : 'outlined'}>{t('mrList.editor.self')}</Button>
    </Stack>
  }
  if (kind === 'project') {
    return <ProjectSearchPicker ariaLabel={t('mrList.editor.field', { condition: t(CONDITION_NAMES.project) })} autoFocus label={t(CONDITION_NAMES.project)} onChange={(id, label) => { if (id) apply({ groupId: '', projectId: id }, label) }} selectedName={values.projectId ? nameOf?.('project', values.projectId) : undefined} value={values.projectId} />
  }
  if (kind === 'group') {
    return <GroupSearchPicker ariaLabel={t('mrList.editor.field', { condition: t(CONDITION_NAMES.group) })} autoFocus label={t(CONDITION_NAMES.group)} onChange={(id, fullPath) => { if (id) apply({ groupId: id, projectId: '' }, fullPath) }} selectedPath={groupPath} value={values.groupId} />
  }
  if (kind === 'updated') return <UpdatedEditor apply={apply} values={values} />
  return <TextEditor apply={apply} kind={kind} values={values} />
}

const TEXT_FIELDS = {
  labels: { field: 'labels', helper: 'mrList.editor.labelsHelper' },
  sourceBranch: { field: 'sourceBranch', helper: 'mrList.editor.branchHelper' },
  targetBranch: { field: 'targetBranch', helper: 'mrList.editor.branchHelper' },
} as const

function TextEditor({ apply, kind, values }: { apply: (patch: Partial<ConditionValues>) => void; kind: keyof typeof TEXT_FIELDS; values: ConditionValues }) {
  const t = useT()
  const { field, helper } = TEXT_FIELDS[kind]
  const [value, setValue] = useState(values[field])
  return <Row component="form" align="top" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); apply({ [field]: value.trim() }) }} spacing={1}>
    <TextField autoFocus fullWidth helperText={t(helper)} label={t(CONDITION_NAMES[kind])} onChange={(event) => setValue(event.target.value)} slotProps={{ htmlInput: { 'aria-label': t('mrList.editor.field', { condition: t(CONDITION_NAMES[kind]) }) } }} value={value} />
    <Button disabled={!value.trim()} type="submit" variant="contained">{t('mrList.editor.apply')}</Button>
  </Row>
}

function UpdatedEditor({ apply, values }: { apply: (patch: Partial<ConditionValues>) => void; values: ConditionValues }) {
  const t = useT()
  const [after, setAfter] = useState(values.updatedAfter.slice(0, 10))
  const [before, setBefore] = useState(values.updatedBefore.slice(0, 10))
  return <Stack component="form" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); apply({ updatedAfter: after, updatedBefore: before }) }} spacing={1}>
    <Row spacing={1}>
      <TextField autoFocus label={t('mrList.editor.updatedFrom')} onChange={(event) => setAfter(event.target.value)} slotProps={{ htmlInput: { 'aria-label': t('mrList.editor.updatedFromAria') }, inputLabel: { shrink: true } }} type="date" value={after} />
      <TextField label={t('mrList.editor.updatedTo')} onChange={(event) => setBefore(event.target.value)} slotProps={{ htmlInput: { 'aria-label': t('mrList.editor.updatedToAria') }, inputLabel: { shrink: true } }} type="date" value={before} />
    </Row>
    <Button disabled={!after && !before} sx={{ alignSelf: 'flex-end' }} type="submit" variant="contained">{t('mrList.editor.apply')}</Button>
  </Stack>
}
