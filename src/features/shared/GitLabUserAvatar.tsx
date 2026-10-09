import { UserAvatar } from '../../components/UserAvatar'
import type { GitLabUser } from '../../types/gitlab'
import { useGitLabAvatar } from './useGitLabAvatar'

/** A GitLab user's avatar loaded through the native side, with an initial while unavailable. */
export function GitLabUserAvatar({ sessionId, size, user }: { sessionId: string | null | undefined; size?: number; user: GitLabUser }) {
  const src = useGitLabAvatar(sessionId, user.avatarUrl)
  return <UserAvatar id={user.id} name={user.name || user.username} size={size} src={src} />
}
