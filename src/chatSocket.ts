import { io, type Socket } from 'socket.io-client'
import { watchChatChanges } from './chatLive'

type Channel = { kind: 'private' | 'group'; id: string }
type SocketReply = { status: number; data: unknown }
type Snapshot = Channel & { page?: unknown; practice?: unknown }
let socket: Socket | null = null
let active: Channel | null = null
let ready = false

export function chatSocketCommand(kind: Channel['kind'], path: string, body?: object): Promise<SocketReply> | null {
  const base = active?.kind === 'private' ? `/chats/${active.id}/` : `/${active?.id}/`
  if (!body || !socket?.connected || !ready || active?.kind !== kind || !path.startsWith(base)) return null
  if (path.endsWith('/typing')) {
    socket.emit('typing', (body as { typing: boolean }).typing)
    return Promise.resolve({ status: 200, data: { ok: true } })
  }
  return new Promise((resolve, reject) => {
    socket!.timeout(10000).emit('command', { path, body }, (error: Error | null, reply: SocketReply) => {
      if (error) reject(new Error('The connection was interrupted. Refresh the conversation before trying again.'))
      else resolve(reply)
    })
  })
}

export function watchConversation(path: string, refresh: () => Promise<void> | void, onSnapshot: (value: Snapshot) => void, onTyping: (value: { typing: boolean; user: { id: string; username: string; avatarSeed: string } }) => void) {
  const match = path.match(/\/api\/(companions\/chats|groups)\/([a-f\d]{24})\/live/)
  if (!match) throw new Error('Invalid conversation.')
  const channel: Channel = { kind: match[1] === 'groups' ? 'group' : 'private', id: match[2] }
  active = channel
  ready = false
  const client = socket = io({ transports: ['websocket'], autoConnect: false })
  let fallback: (() => void) | undefined
  const startFallback = () => { ready = false; fallback ??= watchChatChanges(path, refresh) }
  client.on('connect', () => {
    void refresh()
    client.timeout(10000).emit('subscribe', channel, (error: Error | null, result: { ok?: boolean }) => {
      if (error || !result?.ok) { startFallback(); return }
      ready = true
      fallback?.(); fallback = undefined
    })
  })
  client.on('snapshot', (value: Snapshot) => {
    if (value.kind !== channel.kind || value.id !== channel.id) return
    ready = true
    fallback?.(); fallback = undefined
    onSnapshot(value)
  })
  client.on('practice', (value: Snapshot) => { if (value.kind === channel.kind && value.id === channel.id) onSnapshot(value) })
  client.on('typing', (value) => { if (value.kind === channel.kind && value.id === channel.id) onTyping(value) })
  client.on('disconnect', startFallback)
  client.on('connect_error', startFallback)
  client.on('refresh-error', startFallback)
  client.on('access-lost', () => { void refresh() })
  startFallback()
  client.connect()
  return () => {
    client.removeAllListeners(); client.disconnect(); fallback?.()
    if (socket === client) { socket = null; active = null; ready = false }
  }
}
