import { useCallback, useEffect, useRef, useState } from 'react'
import type { SharedWordPreview } from './CompanionPanel'
import { clearCommunityDirectoryCache, getCommunityDirectory, loadCommunityDirectory } from './communityDirectoryCache'

export type Profile = { id: string; username: string; avatarSeed: string }

export type GroupSummary = {
  id: string
  name: string
  description: string
  state: 'open' | 'closed'
  visibility: 'listed' | 'unlisted'
  memberCount: number
  owner: Profile
  isOwner: boolean
  joined: boolean
  removed: boolean
  createdAt: string
  lastActivityAt: string
  lastMessage?: { text: string; sender: string; isMine: boolean; createdAt: string } | null
  unreadCount?: number
  mentionCount?: number
}

export type GroupDirectory = {
  groups: GroupSummary[]
  ownedCount: number
  ownedLimit: number
  rulesAccepted: boolean
  canModerate: boolean
  suspendedUntil?: string
}

export type GroupMessage = {
  id: string
  sender: Profile | null
  isMine: boolean
  createdAt: string
  canHide: boolean
  kind: 'text' | 'word' | 'unsent' | 'hidden' | 'system'
  text: string
  card?: SharedWordPreview['card']
  reactions: { emoji: string; count: number; mine: boolean }[]
  editedAt?: string
  editableUntil?: string
  reviewedByMe?: boolean
  hasReviews?: boolean
  corrections?: GroupReview[]
  replyTo?: { id: string; isMine: boolean; text: string }
  reported: boolean
}
export type GroupReview = {
  authorId: string
  author: Profile | null
  byMe: boolean
  text?: string
  approved?: boolean
  tags?: string[]
  note?: string
  createdAt: string
  response?: 'thanks' | 'saved'
  reported: boolean
}

export class GroupsApiError extends Error {
  code?: string
  status: number
  constructor(message: string, status: number, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export async function groupsRequest<T>(path: string, body?: object, base = '/api/groups'): Promise<T> {
  const response = await fetch(`${base}${path}`, body ? {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  } : undefined)
  let data: unknown
  try {
    data = JSON.parse(await response.text())
  } catch {
    if (response.status === 404) {
      throw new GroupsApiError('The groups service was not found. Restart the API server and try again.', response.status)
    }
    throw new GroupsApiError(`The groups service returned an unexpected response (HTTP ${response.status}).`, response.status)
  }
  if (!response.ok) {
    const details = data && typeof data === 'object' ? data as { error?: unknown; code?: unknown } : {}
    throw new GroupsApiError(
      typeof details.error === 'string' ? details.error : 'Could not complete the request.',
      response.status,
      typeof details.code === 'string' ? details.code : undefined,
    )
  }
  return data as T
}

export const errorMessage = (failure: unknown, fallback: string) =>
  failure instanceof Error ? failure.message : fallback

// Keeps the directory fresh while the workspace is open; failures keep the last known list.
export function useGroupDirectory(accountId: string | null) {
  const [directory, setDirectory] = useState<GroupDirectory | null>(() => getCommunityDirectory(accountId, 'groups'))
  const [error, setError] = useState<string | null>(null)
  const sequence = useRef(0)

  const reload = useCallback(async (join = false) => {
    const request = ++sequence.current
    try {
      const data = await loadCommunityDirectory(accountId, 'groups', async () => {
        const result = await groupsRequest<GroupDirectory>('/')
        if (!Array.isArray(result.groups)) throw new Error('The groups service returned an incomplete response.')
        return result
      }, join)
      if (request !== sequence.current) return
      setDirectory(data)
      setError(null)
    } catch (failure) {
      if (request !== sequence.current) return
      if (failure instanceof GroupsApiError && [401, 403].includes(failure.status)) {
        clearCommunityDirectoryCache()
        setDirectory(null)
      }
      setError(errorMessage(failure, 'Could not load groups.'))
    }
  }, [accountId])

  useEffect(() => {
    const first = window.setTimeout(() => void reload(true), 0)
    const refresh = () => {
      if (document.visibilityState === 'visible') void reload()
    }
    const timer = window.setInterval(refresh, 30000)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [reload])

  return { directory, error, reload }
}
