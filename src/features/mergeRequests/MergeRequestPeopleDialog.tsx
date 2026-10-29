import Alert from '@mui/material/Alert'
import Autocomplete from '@mui/material/Autocomplete'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useEffect, useId, useMemo, useState } from 'react'

import { useT } from '../../i18n/useT'
import type { GitLabUser, UsersQuery } from '../../types/gitlab'
import { useConnection } from '../connections/connectionContext'
import { useGitLabQuery } from '../shared/useGitLabQuery'
import { matchesMention } from './matchesMention'

/** Picks the full list of assignees or reviewers for a merge request. */
export function MergeRequestPeopleDialog({ current, disabled, label, onClose, onSave, open, participants = EMPTY_USERS }: {
  current: GitLabUser[]
  disabled: boolean
  label: string
  onClose: () => void
  onSave: (users: GitLabUser[]) => Promise<boolean>
  open: boolean
  /** People of the MR, offered before typing and matched by any part of their name, ahead of the server search. */
  participants?: GitLabUser[]
}) {
  const t = useT()
  const titleId = useId()
  const { session } = useConnection()
  const [selected, setSelected] = useState<GitLabUser[]>(current)
  const [searchText, setSearchText] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const timer = globalThis.setTimeout(() => setDebouncedSearch(searchText.trim()), 350)
    return () => globalThis.clearTimeout(timer)
  }, [searchText])

  const query = useMemo<UsersQuery | null>(() => session && debouncedSearch.length >= 2 ? { kind: 'users', page: 1, search: debouncedSearch } : null, [debouncedSearch, session])
  const result = useGitLabQuery<UsersQuery>(session?.id ?? null, query)
  const trimmed = searchText.trim()
  const serverUsers = trimmed.length >= 2 ? result.data : undefined
  const options = useMemo(() => {
    const matches = participants.filter((user) => matchesMention(user, trimmed))
    const seen = new Set(matches.map((user) => user.id))
    return [...matches, ...(serverUsers ?? EMPTY_USERS).filter((user) => !seen.has(user.id))]
  }, [participants, serverUsers, trimmed])
  const self = session?.user
  const unchanged = sameIds(selected, current)
  const busy = disabled || saving

  const save = async () => {
    if (busy || unchanged) return
    setSaving(true)
    setFailed(false)
    try {
      if (await onSave(selected)) onClose()
      else setFailed(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog aria-labelledby={titleId} fullWidth maxWidth="sm" onClose={saving ? undefined : onClose} open={open}>
      <DialogTitle id={titleId}>{t('mergeRequest.people.title', { label })}</DialogTitle>
      <DialogContent>
        <Stack spacing={1} sx={{ pt: 0.5 }}>
          <Autocomplete<GitLabUser, true, false, false>
            disabled={busy}
            filterOptions={(available) => available}
            filterSelectedOptions
            getOptionKey={(user) => user.id}
            getOptionLabel={(user) => `${user.name} @${user.username}`}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            loading={result.loading || result.refreshing}
            loadingText={t('mergeRequest.common.searching')}
            multiple
            noOptionsText={result.error ? t('mergeRequest.people.loadFailed') : trimmed.length < 2 ? t('mergeRequest.people.minLength') : t('mergeRequest.common.noOptions')}
            onChange={(_, users) => setSelected(users)}
            onInputChange={(_, value, reason) => { if (reason === 'input' || reason === 'clear') setSearchText(value) }}
            options={options}
            renderInput={(params) => <TextField {...params} autoFocus label={label} placeholder={t('mergeRequest.people.placeholder')} size="small" />}
            renderOption={(optionProps, user) => {
              const { key, ...rest } = optionProps
              return <li key={key} {...rest}><Stack spacing={0.25} sx={{ minWidth: 0 }}><Typography variant="body2">{user.name}</Typography><Typography color="textSecondary" variant="caption">@{user.username}</Typography></Stack></li>
            }}
            value={selected}
          />
          {self && !selected.some((user) => user.id === self.id) ? <Button disabled={busy} onClick={() => setSelected((users) => [...users, self])} size="small" sx={{ alignSelf: 'flex-start' }}>{t('mergeRequest.people.addSelf')}</Button> : null}
          <Typography color="textSecondary" variant="caption">{t('mergeRequest.people.limitNote')}</Typography>
          {failed ? <Alert severity="error">{t('mergeRequest.people.saveFailed', { label })}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={saving} onClick={onClose}>{t('mergeRequest.common.cancel')}</Button>
        <Button disabled={busy || unchanged} onClick={() => void save()} variant="contained">{saving ? t('mergeRequest.people.saving') : t('mergeRequest.people.save')}</Button>
      </DialogActions>
    </Dialog>
  )
}

const EMPTY_USERS: GitLabUser[] = []

function sameIds(left: GitLabUser[], right: GitLabUser[]): boolean {
  return left.length === right.length && left.every((user) => right.some((other) => other.id === user.id))
}
