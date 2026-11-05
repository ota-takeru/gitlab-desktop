import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'

import { useT } from '../../i18n/useT'
import type { GitLabBranch } from '../../types/gitlab'

/**
 * The branch a project's code or history is read from; no value is the default branch.
 * The branch list is the 30 most recently updated; a branch chosen earlier stays selectable.
 */
export function BranchSelect({ branches, onChange, value }: { branches: GitLabBranch[] | null; onChange: (ref: string | undefined) => void; value?: string }) {
  const t = useT()
  const defaultBranch = branches?.find((branch) => branch.default)?.name
  const names = (branches ?? []).map((branch) => branch.name)
  if (value && !names.includes(value)) names.unshift(value)
  const defaultLabel = defaultBranch ? t('project.code.defaultBranchNamed', { branch: defaultBranch }) : t('project.code.defaultBranch')
  return <Select
    aria-label={t('project.code.branch')}
    displayEmpty
    onChange={(event) => onChange(event.target.value || undefined)}
    renderValue={(selected) => selected || defaultLabel}
    sx={{ flexShrink: 0, fontFamily: 'code.fontFamily', maxWidth: 240, typography: 'body2' }}
    value={value ?? ''}
  >
    <MenuItem value="">{defaultLabel}</MenuItem>
    {names.filter((name) => name !== defaultBranch).map((name) => <MenuItem key={name} sx={{ fontFamily: 'code.fontFamily' }} value={name}>{name}</MenuItem>)}
  </Select>
}
