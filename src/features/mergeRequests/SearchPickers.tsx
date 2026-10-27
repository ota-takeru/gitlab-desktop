import Autocomplete from '@mui/material/Autocomplete'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useEffect, useMemo, useState } from 'react'

import type { GitLabGroup, GitLabUser, GroupsQuery, Project, ProjectQuery, UsersQuery } from '../../types/gitlab'
import { useConnection } from '../connections/connectionContext'
import { useGitLabQuery } from '../shared/useGitLabQuery'

interface SearchPickerProps {
  ariaLabel: string
  label: string
  value: string
  /** `label` is how the choice reads in a condition tag, or empty when it is cleared. */
  onChange: (id: string, label: string) => void
  autoFocus?: boolean
  /** The name of the selected ID, when the caller knows it. */
  selectedName?: string
}

interface PickerOption {
  id: string
  name: string
  detail: string
}

export function UserSearchPicker({ selectedName, ...props }: SearchPickerProps) {
  const { session } = useConnection()
  const [searchText, setSearchText] = useState('')
  const debouncedSearch = useDebouncedSearch(searchText)
  const query = useMemo<UsersQuery | null>(() => session && debouncedSearch.trim().length >= 2
    ? { kind: 'users', page: 1, search: debouncedSearch.trim() }
    : null, [debouncedSearch, session])
  const result = useGitLabQuery<UsersQuery>(session?.id ?? null, query)
  const options = useMemo(() => (result.data ?? []).map(userOption), [result.data])

  return (
    <CandidatePicker
      {...props}
      fallback={(value) => savedIdOption(value, selectedName)}
      loading={result.loading || result.refreshing}
      noOptionsText={result.error ? 'ユーザー候補を取得できませんでした' : searchText.trim().length < 2 ? '2文字以上入力してください' : '候補がありません'}
      onSearchTextChange={setSearchText}
      options={options}
      queryError={result.error?.message ?? null}
    />
  )
}

export function ProjectSearchPicker({ selectedName, ...props }: SearchPickerProps) {
  const { session } = useConnection()
  const [searchText, setSearchText] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [browseEmpty, setBrowseEmpty] = useState(false)

  useEffect(() => {
    const timer = globalThis.setTimeout(() => setDebouncedSearch(searchText), 350)
    return () => globalThis.clearTimeout(timer)
  }, [searchText])

  const query = useMemo<ProjectQuery | null>(() => {
    if (!session) return null
    const search = debouncedSearch.trim()
    if (search.length >= 2) return { includeArchived: false, kind: 'projects', membership: false, page: 1, search }
    if (open && browseEmpty && search.length === 0) return { includeArchived: false, kind: 'projects', membership: false, page: 1, search: '' }
    return null
  }, [browseEmpty, debouncedSearch, open, session])
  const result = useGitLabQuery<ProjectQuery>(session?.id ?? null, query)
  const options = useMemo(() => (result.data ?? []).map(projectOption), [result.data])

  return (
    <CandidatePicker
      {...props}
      fallback={(value) => savedIdOption(value, selectedName)}
      loading={result.loading || result.refreshing}
      onChange={(id) => props.onChange(id, result.data?.find((project) => project.id === id)?.pathWithNamespace ?? '')}
      noOptionsText={result.error ? 'プロジェクト候補を取得できませんでした' : searchText.trim().length < 2 ? '2文字以上入力するか、開いて候補を表示してください' : '候補がありません'}
      onClose={() => setOpen(false)}
      onOpen={() => { setOpen(true); if (!searchText.trim()) setBrowseEmpty(true) }}
      onSearchTextChange={(value, reason) => {
        setSearchText(value)
        if (value.trim()) setBrowseEmpty(false)
        else if (reason === 'clear') setBrowseEmpty(true)
      }}
      options={options}
      queryError={result.error?.message ?? null}
    />
  )
}

/**
 * Finds a group by name or path. The condition stores the group's ID; a path
 * saved by earlier versions stays selected as it is, since GitLab accepts both.
 */
export function GroupSearchPicker({ onChange, selectedPath, ...props }: Omit<SearchPickerProps, 'onChange'> & {
  onChange: (id: string, fullPath: string) => void
  /** The full path of the selected ID, when the caller knows it. */
  selectedPath?: string
}) {
  const { session } = useConnection()
  const [searchText, setSearchText] = useState('')
  const debouncedSearch = useDebouncedSearch(searchText)
  const query = useMemo<GroupsQuery | null>(() => session && debouncedSearch.trim().length >= 2
    ? { kind: 'groups', page: 1, search: debouncedSearch.trim() }
    : null, [debouncedSearch, session])
  const result = useGitLabQuery<GroupsQuery>(session?.id ?? null, query)
  const options = useMemo(() => (result.data ?? []).map(groupOption), [result.data])

  return (
    <CandidatePicker
      {...props}
      fallback={(value) => savedGroupOption(value, selectedPath)}
      loading={result.loading || result.refreshing}
      noOptionsText={result.error ? 'グループ候補を取得できませんでした' : searchText.trim().length < 2 ? '2文字以上入力してください' : '候補がありません'}
      onChange={(id) => onChange(id, result.data?.find((group) => group.id === id)?.fullPath ?? '')}
      onSearchTextChange={setSearchText}
      options={options}
      queryError={result.error?.message ?? null}
    />
  )
}

function CandidatePicker({ ariaLabel, autoFocus, fallback, label, loading, noOptionsText, onChange, onClose, onOpen, onSearchTextChange, options, queryError, value }: Omit<SearchPickerProps, 'onChange'> & {
  onChange: (id: string, label: string) => void
  /** Stands in for a value whose candidate is not loaded. */
  fallback: (value: string) => PickerOption | null
  loading: boolean
  noOptionsText: string
  onClose?: () => void
  onOpen?: () => void
  onSearchTextChange: (value: string, reason?: 'input' | 'clear') => void
  options: PickerOption[]
  queryError: string | null
}) {
  const selected = options.find((option) => option.id === value) ?? fallback(value)
  const pickerOptions = selected && !options.some((option) => option.id === selected.id) ? [selected, ...options] : options

  return (
    <Autocomplete<PickerOption, false, false, false>
      autoHighlight
      getOptionLabel={getOptionLabel}
      isOptionEqualToValue={(option, candidate) => option.id === candidate.id}
      loading={loading}
      loadingText="検索中…"
      noOptionsText={noOptionsText}
      onChange={(_, option) => onChange(option?.id ?? '', option?.name ?? '')}
      onClose={onClose}
      onInputChange={(_, nextValue, reason) => {
        if (reason === 'input' || reason === 'clear') onSearchTextChange(nextValue, reason)
      }}
      onOpen={onOpen}
      options={pickerOptions}
      renderInput={(params) => <TextField {...params} autoFocus={autoFocus} error={Boolean(queryError)} helperText={queryError ?? undefined} label={label} size="small" slotProps={{ ...params.slotProps, htmlInput: { ...params.slotProps.htmlInput, 'aria-label': ariaLabel } }} />}
      renderOption={(optionProps, option) => (
        <li {...optionProps}>
          <Stack spacing={0.25} sx={{ minWidth: 0 }}>
            <Typography variant="body2">{option.name}</Typography>
            <Typography color="textSecondary" variant="caption" sx={{ overflowWrap: 'anywhere' }}>{option.detail}</Typography>
          </Stack>
        </li>
      )}
      value={selected}
      filterOptions={(available) => available}
    />
  )
}

/** Only a real ID stands in for a person or project whose candidate is not loaded, named when the caller knows it; anything else is no choice yet. */
function savedIdOption(value: string, name?: string): PickerOption | null {
  if (!/^[1-9]\d*$/u.test(value)) return null
  return name ? { detail: `ID ${value}`, id: value, name } : { detail: '保存済みのID', id: value, name: `ID ${value}` }
}

function savedGroupOption(value: string, fullPath: string | undefined): PickerOption | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (!/^[1-9]\d*$/u.test(trimmed)) return { detail: '保存済みのグループパス', id: value, name: trimmed }
  return fullPath ? { detail: `ID ${trimmed}`, id: value, name: fullPath } : savedIdOption(trimmed)
}

function useDebouncedSearch(value: string): string {
  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => {
    const timer = globalThis.setTimeout(() => setDebouncedSearch(value), 350)
    return () => globalThis.clearTimeout(timer)
  }, [value])
  return debouncedSearch
}

function userOption(user: GitLabUser): PickerOption {
  return { detail: `@${user.username} · ID ${user.id}`, id: user.id, name: user.name }
}

function projectOption(project: Project): PickerOption {
  return { detail: `${project.pathWithNamespace} · ID ${project.id}`, id: project.id, name: project.name }
}

function groupOption(group: GitLabGroup): PickerOption {
  return { detail: `${group.fullPath} · ID ${group.id}`, id: group.id, name: group.name }
}

function getOptionLabel(option: PickerOption): string {
  return `${option.name} · ${option.detail}`
}
