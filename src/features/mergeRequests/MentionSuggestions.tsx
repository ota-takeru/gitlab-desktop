import Box from '@mui/material/Box'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { useEffect, useMemo, useState } from 'react'

import type { GitLabUser, UsersQuery } from '../../types/gitlab'
import { useConnection } from '../connections/connectionContext'
import { useGitLabQuery } from '../shared/useGitLabQuery'
import { useT } from '../../i18n/useT'
import { matchesMention } from './matchesMention'

export function MentionSuggestions({ id, onSelect, onUsersChange, optionId, participants, search, selectedIndex }: { id: string; onSelect: (user: GitLabUser) => void; onUsersChange: (users: GitLabUser[]) => void; optionId: (index: number) => string; participants: GitLabUser[]; search: string; selectedIndex: number }) {
  const t = useT()
  const { session } = useConnection()
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const trimmed = search.trim()
  const searchesServer = trimmed.length >= 2

  useEffect(() => {
    const timer = globalThis.setTimeout(() => setDebouncedSearch(search.trim()), 350)
    return () => globalThis.clearTimeout(timer)
  }, [search])

  const query: UsersQuery | null = session && searchesServer && trimmed === debouncedSearch
    ? { kind: 'users', page: 1, search: debouncedSearch }
    : null
  const result = useGitLabQuery<UsersQuery>(session?.id ?? null, query)
  const searched = searchesServer && trimmed === debouncedSearch
  const serverUsers = searched ? (result.data ?? EMPTY_USERS) : EMPTY_USERS
  const users = useMemo(() => {
    const matches = participants.filter((user) => matchesMention(user, trimmed))
    const seen = new Set(matches.map((user) => user.id))
    return [...matches, ...serverUsers.filter((user) => !seen.has(user.id))].slice(0, 8)
  }, [participants, serverUsers, trimmed])

  useEffect(() => {
    onUsersChange(users)
  }, [onUsersChange, users])

  const searching = searchesServer && (!searched || result.loading)
  if (!users.length && !searchesServer) return null
  return (
    <Paper elevation={4} sx={{ maxHeight: 240, maxWidth: 360, minWidth: 240, overflowY: 'auto', p: 0.5 }}>
      {!users.length && searching ? <Typography color="textSecondary" role="status" sx={{ display: 'block', p: 1 }} variant="caption">{t('review.mention.searching')}</Typography> : null}
      {!users.length && !searching ? <Typography color="textSecondary" role="status" sx={{ display: 'block', p: 1 }} variant="caption">{t('review.mention.none')}</Typography> : null}
      {/* The editor keeps the focus; ↑/↓ move aria-activedescendant through these options. */}
      <Box aria-label={t('review.mention.label')} component="ul" id={id} role="listbox" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {users.map((user, index) => (
          <Box
            aria-selected={index === selectedIndex}
            component="li"
            id={optionId(index)}
            key={user.id}
            onClick={() => onSelect(user)}
            onMouseDown={(event) => event.preventDefault()}
            role="option"
            sx={{ bgcolor: index === selectedIndex ? 'action.selected' : 'transparent', borderRadius: 1, cursor: 'pointer', px: 1, py: 0.5, '&:hover': { bgcolor: 'action.hover' } }}
          ><Typography component="span" variant="body2">{user.name}</Typography><Typography color="textSecondary" component="span" sx={{ ml: 1 }} variant="caption">@{user.username}</Typography></Box>
        ))}
      </Box>
    </Paper>
  )
}

const EMPTY_USERS: GitLabUser[] = []
