import Autocomplete from '@mui/material/Autocomplete'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useEffect, useMemo, useState } from 'react'

import type { GitLabUser, Project, ProjectQuery, UsersQuery } from '../../types/gitlab'
import { useConnection } from '../connections/ConnectionProvider'
import { useGitLabQuery } from '../shared/useGitLabQuery'

interface SearchPickerProps {
  ariaLabel: string
  label: string
  value: string
  onChange: (id: string) => void
}

interface PickerOption {
  id: string
  name: string
  detail: string
}

export function UserSearchPicker(props: SearchPickerProps) {
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
      loading={result.loading || result.refreshing}
      noOptionsText={result.error ? 'ユーザー候補を取得できませんでした' : searchText.trim().length < 2 ? '2文字以上入力してください' : '候補がありません'}
      onSearchTextChange={setSearchText}
      options={options}
      queryError={result.error?.message ?? null}
    />
  )
}

export function ProjectSearchPicker(props: SearchPickerProps) {
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
      loading={result.loading || result.refreshing}
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

function CandidatePicker({ ariaLabel, label, loading, noOptionsText, onChange, onClose, onOpen, onSearchTextChange, options, queryError, value }: SearchPickerProps & {
  loading: boolean
  noOptionsText: string
  onClose?: () => void
  onOpen?: () => void
  onSearchTextChange: (value: string, reason?: 'input' | 'clear') => void
  options: PickerOption[]
  queryError: string | null
}) {
  const selected = options.find((option) => option.id === value) ?? (value ? { detail: '保存済みのID', id: value, name: `ID ${value}` } : null)
  const pickerOptions = selected && !options.some((option) => option.id === selected.id) ? [selected, ...options] : options

  return (
    <Autocomplete<PickerOption, false, false, false>
      autoHighlight
      getOptionLabel={getOptionLabel}
      isOptionEqualToValue={(option, candidate) => option.id === candidate.id}
      loading={loading}
      loadingText="検索中…"
      noOptionsText={noOptionsText}
      onChange={(_, option) => onChange(option?.id ?? '')}
      onClose={onClose}
      onInputChange={(_, nextValue, reason) => {
        if (reason === 'input' || reason === 'clear') onSearchTextChange(nextValue, reason)
      }}
      onOpen={onOpen}
      options={pickerOptions}
      renderInput={(params) => <TextField {...params} error={Boolean(queryError)} helperText={queryError ?? undefined} label={label} size="small" slotProps={{ ...params.slotProps, htmlInput: { ...params.slotProps.htmlInput, 'aria-label': ariaLabel } }} />}
      renderOption={(optionProps, option) => (
        <li {...optionProps}>
          <Stack spacing={0.125} sx={{ minWidth: 0 }}>
            <Typography variant="body2">{option.name}</Typography>
            <Typography color="text.secondary" variant="caption" sx={{ overflowWrap: 'anywhere' }}>{option.detail}</Typography>
          </Stack>
        </li>
      )}
      value={selected}
      filterOptions={(available) => available}
    />
  )
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

function getOptionLabel(option: PickerOption): string {
  return `${option.name} · ${option.detail}`
}
