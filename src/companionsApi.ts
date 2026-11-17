import { groupsRequest, type GroupDirectory } from './groupsApi'
import { loadCommunityDirectory } from './communityDirectoryCache'
import type { CompanionDirectory } from './CompanionPanel'

export class CompanionApiError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export async function request(path: string, body?: object): Promise<unknown> {
  const response = await fetch(`/api/companions${path}`, body ? {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  } : undefined)
  let data: unknown
  const bodyText = await response.text()
  try {
    data = JSON.parse(bodyText)
  } catch {
    const status = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`
    if (response.status === 404) {
      throw new CompanionApiError(`The companion API route was not found (${status}). Restart the API server and make sure the app points to the correct API port.`, response.status)
    }
    throw new CompanionApiError(`The companion service returned a non-JSON response (${status}).`, response.status)
  }
  if (!response.ok) {
    const error = data && typeof data === 'object' && 'error' in data ? data.error : null
    throw new CompanionApiError(typeof error === 'string' ? error : 'Could not complete the request.', response.status)
  }
  return data
}

export async function fetchCompanionDirectory(): Promise<CompanionDirectory> {
  const [accountData, chatData] = await Promise.all([
    request('/') as Promise<Omit<CompanionDirectory, 'chats'>>,
    request('/chats') as Promise<Pick<CompanionDirectory, 'chats'>>,
  ])
  if (!Array.isArray(accountData.companions) || !Array.isArray(accountData.sharedWords)
    || typeof accountData.emailsEnabled !== 'boolean' || !Array.isArray(chatData.chats)) {
    throw new Error('The companion service returned an incomplete response.')
  }
  return { ...accountData, chats: chatData.chats }
}

export async function prefetchCommunity(accountId: string) {
  await Promise.all([
    loadCommunityDirectory(accountId, 'companions', fetchCompanionDirectory, true),
    loadCommunityDirectory(accountId, 'groups', async () => {
      const data = await groupsRequest<GroupDirectory>('/')
      if (!Array.isArray(data.groups)) throw new Error('The groups service returned an incomplete response.')
      return data
    }, true),
  ])
}
