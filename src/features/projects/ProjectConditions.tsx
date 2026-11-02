import Button from '@mui/material/Button'
import MenuItem from '@mui/material/MenuItem'
import MenuList from '@mui/material/MenuList'
import Popover from '@mui/material/Popover'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useState } from 'react'

import { Row } from '../../components/Row'
import { useT } from '../../i18n/useT'
import type { GitLabUser } from '../../types/gitlab'
import { GroupSearchPicker, UserSearchPicker } from '../mergeRequests/SearchPickers'
import { ACCESS_NAMES, CONDITION_NAMES, contributorPatch, type ProjectConditionKind, type ProjectFilterValues, VISIBILITY_NAMES } from './projectFilters'

/**
 * Edits one condition in a popover under its tag or the search field, as the MR
 * list's does. The editor renders inside the list's search form in the React
 * tree, so its own forms stop their submit from also submitting the search text.
 */
export function ProjectConditionEditor({ anchorEl, currentUser, kind, onApply, onClose, values }: {
  anchorEl: HTMLElement | null
  currentUser: GitLabUser
  kind: ProjectConditionKind | null
  onApply: (patch: Partial<ProjectFilterValues>) => void
  onClose: () => void
  values: ProjectFilterValues
}) {
  const t = useT()
  const apply = (patch: Partial<ProjectFilterValues>) => {
    onApply(patch)
    onClose()
  }
  const menu = kind === 'visibility' || kind === 'access'
  return <Popover
    anchorEl={anchorEl}
    anchorOrigin={{ horizontal: 'left', vertical: 'bottom' }}
    onClose={onClose}
    open={Boolean(anchorEl && kind)}
    slotProps={{ paper: { 'aria-label': kind ? t('project.editor.dialog', { condition: t(CONDITION_NAMES[kind]) }) : undefined, role: 'dialog', sx: { mt: 0.5, p: menu ? 0.5 : 1.5, width: menu ? 220 : 360 } } }}
  >
    {kind ? <EditorBody apply={apply} currentUser={currentUser} kind={kind} values={values} /> : null}
  </Popover>
}

function EditorBody({ apply, currentUser, kind, values }: { apply: (patch: Partial<ProjectFilterValues>) => void; currentUser: GitLabUser; kind: ProjectConditionKind; values: ProjectFilterValues }) {
  const t = useT()
  if (kind === 'contributor') {
    const self = values.contributorId === currentUser.id
    return <Stack spacing={1}>
      <UserSearchPicker
        ariaLabel={t('project.editor.field', { condition: t(CONDITION_NAMES.contributor) })}
        autoFocus
        label={t(CONDITION_NAMES.contributor)}
        onChange={(id, label) => { if (id) apply(contributorPatch(id, label)) }}
        selectedName={values.contributorId && !self ? values.contributorName : undefined}
        value={self ? '' : values.contributorId}
      />
      <Button onClick={() => apply(contributorPatch(currentUser.id, currentUser.name))} sx={{ alignSelf: 'flex-start' }} variant={self ? 'contained' : 'outlined'}>{t('project.editor.self')}</Button>
      <Typography color="textSecondary" variant="caption">{t('project.editor.contributorHelper')}</Typography>
    </Stack>
  }
  if (kind === 'visibility') {
    return <MenuList autoFocusItem dense>
      {(['public', 'internal', 'private'] as const).map((visibility) => <MenuItem key={visibility} onClick={() => apply({ visibility })} selected={values.visibility === visibility}>{t(VISIBILITY_NAMES[visibility])}</MenuItem>)}
    </MenuList>
  }
  if (kind === 'access') {
    return <MenuList autoFocusItem dense>
      {['20', '30', '40', '50'].map((level) => <MenuItem key={level} onClick={() => apply({ minAccessLevel: level })} selected={values.minAccessLevel === level}>{t(ACCESS_NAMES[level])}</MenuItem>)}
    </MenuList>
  }
  if (kind === 'group') {
    // Neither filter is available in a group's list.
    return <GroupSearchPicker ariaLabel={t('project.editor.field', { condition: t(CONDITION_NAMES.group) })} autoFocus label={t(CONDITION_NAMES.group)} onChange={(groupId, groupPath) => { if (groupId) apply({ activityAfter: '', activityBefore: '', groupId, groupPath, language: '' }) }} selectedPath={values.groupPath || undefined} value={values.groupId} />
  }
  if (kind === 'activity') return <ActivityEditor apply={apply} values={values} />
  if (kind === 'starred') return null
  return <TextEditor apply={apply} field={kind} values={values} />
}

function TextEditor({ apply, field, values }: { apply: (patch: Partial<ProjectFilterValues>) => void; field: 'topics' | 'language'; values: ProjectFilterValues }) {
  const t = useT()
  const [value, setValue] = useState(values[field])
  return <Row component="form" align="top" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); apply({ [field]: value.trim() }) }} spacing={1}>
    <TextField autoFocus fullWidth helperText={t(field === 'topics' ? 'project.editor.topicsHelper' : 'project.editor.languageHelper')} label={t(CONDITION_NAMES[field])} onChange={(event) => setValue(event.target.value)} slotProps={{ htmlInput: { 'aria-label': t('project.editor.field', { condition: t(CONDITION_NAMES[field]) }) } }} value={value} />
    <Button disabled={!value.trim()} type="submit" variant="contained">{t('project.editor.apply')}</Button>
  </Row>
}

function ActivityEditor({ apply, values }: { apply: (patch: Partial<ProjectFilterValues>) => void; values: ProjectFilterValues }) {
  const t = useT()
  const [after, setAfter] = useState(values.activityAfter)
  const [before, setBefore] = useState(values.activityBefore)
  const reversed = Boolean(after && before && after > before)
  return <Stack component="form" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); apply({ activityAfter: after, activityBefore: before }) }} spacing={1}>
    <Row spacing={1}>
      <TextField autoFocus label={t('project.editor.activityFrom')} onChange={(event) => setAfter(event.target.value)} slotProps={{ htmlInput: { 'aria-label': t('project.editor.activityFromAria') }, inputLabel: { shrink: true } }} type="date" value={after} />
      <TextField error={reversed} label={t('project.editor.activityTo')} onChange={(event) => setBefore(event.target.value)} slotProps={{ htmlInput: { 'aria-label': t('project.editor.activityToAria') }, inputLabel: { shrink: true } }} type="date" value={before} />
    </Row>
    <Button disabled={(!after && !before) || reversed} sx={{ alignSelf: 'flex-end' }} type="submit" variant="contained">{t('project.editor.apply')}</Button>
  </Stack>
}
