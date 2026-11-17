import { useCallback, useEffect, useState } from 'react'

export type Profile = { id: string; username: string; avatarSeed: string }

export type GroupSummary = {
  id: string
  name: string
  description: string
  state: 'open' | 'closed'
  memberCount: number
  owner: Profile
  isOwner: boolean
  joined: boolean
  removed: boolean
  createdAt: string
  lastActivityAt: string
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
  kind: 'text' | 'unsent' | 'hidden'
  text: string
  replyTo?: { id: string; isMine: boolean; text: string }
  reported: boolean
}

export class GroupsApiError extends Error {
  code?: string
  constructor(message: string, code?: string) {
    super(message)
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
      throw new GroupsApiError('The groups service was not found. Restart the API server and try again.')
    }
    throw new GroupsApiError(`The groups service returned an unexpected response (HTTP ${response.status}).`)
  }
  if (!response.ok) {
    const details = data && typeof data === 'object' ? data as { error?: unknown; code?: unknown } : {}
    throw new GroupsApiError(
      typeof details.error === 'string' ? details.error : 'Could not complete the request.',
      typeof details.code === 'string' ? details.code : undefined,
    )
  }
  return data as T
}

export const errorMessage = (failure: unknown, fallback: string) =>
  failure instanceof Error ? failure.message : fallback

// Keeps the directory fresh while the workspace is open; failures keep the last known list.
export function useGroupDirectory() {
  const [directory, setDirectory] = useState<GroupDirectory | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      const data = await groupsRequest<GroupDirectory>('/')
      if (!Array.isArray(data.groups)) throw new Error('The groups service returned an incomplete response.')
      setDirectory(data)
      setError(null)
    } catch (failure) {
      setError(errorMessage(failure, 'Could not load groups.'))
    }
  }, [])

  useEffect(() => {
    const first = window.setTimeout(() => void reload(), 0)
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
