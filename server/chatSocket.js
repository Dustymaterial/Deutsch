import { Server } from 'socket.io'
import { EventEmitter } from 'node:events'
import { messageDelta } from './chatDelta.js'

// Reuse the HTTP router's validation, limits and recipient-specific serializers.
export function dispatchChat(router, request, method, path, body) {
  return new Promise((resolve) => {
    const req = Object.create(request)
    const url = new URL(path, 'http://localhost')
    Object.assign(req, { method, url: url.pathname + url.search, originalUrl: path, body })
    Object.defineProperty(req, 'query', { value: Object.fromEntries(url.searchParams), configurable: true })
    const headers = new Map()
    const res = Object.assign(new EventEmitter(), {
      statusCode: 200,
      status(code) { this.statusCode = code; return this },
      setHeader(key, value) { headers.set(key.toLowerCase(), value); return this },
      getHeader(key) { return headers.get(key.toLowerCase()) },
      header(key, value) { return this.setHeader(key, value) },
      append(key, value) { return this.setHeader(key, this.getHeader(key) ? `${this.getHeader(key)}, ${value}` : value) },
      set(key, value) { if (typeof key === 'object') { for (const [name, item] of Object.entries(key)) this.setHeader(name, item) } else this.setHeader(key, value); return this },
      json(data) { resolve({ status: this.statusCode, data }); return this },
      send(data) { resolve({ status: this.statusCode, data }); return this },
      end() { resolve({ status: this.statusCode, data: {} }); return this },
    })
    router.handle(req, res, (error) => { if (error) console.error('Socket command failed:', error.message); resolve({ status: error ? 500 : 404, data: { error: 'Could not complete the request.' } }) })
  })
}

export function createChatSocket({ server, sessionMiddleware, requireUser, routers, authorize }) {
  const io = new Server(server, {
    transports: ['websocket'], maxHttpBufferSize: 64 * 1024,
    allowRequest: (req, done) => {
      const origin = req.headers.origin
      try { done(null, !origin || new URL(origin).host === req.headers.host) } catch { done(null, false) }
    },
  })
  io.engine.use(sessionMiddleware)
  const clients = new Set()
  const typingBudgets = new Map()
  const prune = setInterval(() => { for (const [id, budget] of typingBudgets) if (budget.until <= Date.now()) typingBudgets.delete(id) }, 60000)
  prune.unref()
  server.on('close', () => clearInterval(prune))
  async function authenticated(socket) {
    if (!socket.request.session) return false
    await new Promise((resolve, reject) => socket.request.session?.reload((error) => error ? reject(error) : resolve()))
    if (socket.request.session.cookie?.expires && new Date(socket.request.session.cookie.expires) <= new Date()) return false
    let allowed = false
    await requireUser(socket.request, { status: () => ({ json: () => {} }) }, () => { allowed = true })
    return allowed && Boolean(socket.request.accountUser?.emailVerifiedAt)
  }
  io.use((socket, next) => { void authenticated(socket).then((ok) => next(ok ? undefined : new Error('Sign in to connect.'))).catch(() => next(new Error('Session expired.'))) })
  function prefix(kind, id) { return kind === 'private' ? `/chats/${id}` : `/${id}` }
  async function snapshot(socket, changedIds = [], practiceOnly = false) {
    const channel = socket.data.channel
    if (!channel || !socket.connected) return
    if (!await authenticated(socket) || !await authorize(channel.kind, socket.request, channel.id)) { socket.emit('access-lost'); socket.disconnect(); return }
    const base = prefix(channel.kind, channel.id)
    const practice = channel.kind === 'private' ? await dispatchChat(routers.private, socket.request, 'GET', `${base}/practice`) : null
    if (practice?.status === 200 && socket.connected && socket.data.channel === channel) {
      const signature = JSON.stringify(practice.data.practice)
      if (signature !== socket.data.practiceSignature) { socket.data.practiceSignature = signature; socket.emit('practice', { ...channel, practice: practice.data.practice }) }
    }
    if (practiceOnly) return
    let page = changedIds.length && socket.data.pageInfo
      ? { status: 200, data: { ...socket.data.pageInfo, messages: [] } }
      : socket.data.resume ? await dispatchChat(routers[channel.kind], socket.request, 'GET', `${base}/sync?cursor=${encodeURIComponent(socket.data.resume.cursor)}`)
        : await dispatchChat(routers[channel.kind], socket.request, 'GET', `${base}/messages?read=0&live=1`)
    if (socket.data.resume) {
      if (page.status === 200 && page.data.reset === false) page.data.hasMore = socket.data.resume.hasMore
      else { page = await dispatchChat(routers[channel.kind], socket.request, 'GET', `${base}/messages?read=0`); page.data.reset = true }
      socket.data.resume = undefined
    }
    if (page.status !== 200) { socket.emit('access-lost'); return }
    socket.data.pageInfo = { ...page.data, messages: [] }
    delete socket.data.pageInfo.reset
    for (const id of changedIds) {
      if (channel.kind === 'private' && await routers.private.chatMessageChannel(socket.request, id) !== channel.id) continue
      const message = channel.kind === 'private' ? await routers.private.chatMessage(socket.request, id)
        : (await dispatchChat(routers.group, socket.request, 'GET', `${base}/messages/${id}`)).data.message
      if (message && !page.data.messages.some((item) => item.id === message.id)) page.data.messages.push(message)
    }
    if (socket.connected && socket.data.channel === channel) {
      const delta = messageDelta(socket.data.delta, page.data)
      if (delta) socket.emit('snapshot', { ...channel, page: delta })
    }
  }
  function publish(kind, id, messageId, practiceOnly = false) {
    for (const socket of clients) {
      if (socket.data.channel?.kind !== kind || socket.data.channel?.id !== id) continue
      socket.data.pending = true
      if (!practiceOnly) socket.data.messagesPending = true
      socket.data.changedIds ??= new Set()
      if (messageId && socket.data.changedIds.size < 100) socket.data.changedIds.add(messageId)
      if (socket.data.refreshing) continue
      socket.data.refreshing = true
      void (async () => {
        try { while (socket.data.pending && socket.connected) { socket.data.pending = false; const ids = [...socket.data.changedIds]; socket.data.changedIds.clear(); const onlyPractice = !socket.data.messagesPending; socket.data.messagesPending = false; await snapshot(socket, ids, onlyPractice) } }
        catch { socket.emit('refresh-error') }
        finally { socket.data.refreshing = false }
      })()
    }
  }
  io.on('connection', (socket) => {
    clients.add(socket)
    let count = 0
    const limiter = setInterval(() => { count = 0 }, 60000)
    socket.on('subscribe', async (channel, ack) => {
      if (typeof ack !== 'function') return
      try {
        if (++count > 120 || !['private', 'group'].includes(channel?.kind) || !/^[a-f\d]{24}$/.test(channel?.id) || !await authenticated(socket) || !await authorize(channel.kind, socket.request, channel.id)) throw new Error()
        socket.data.channel = { kind: channel.kind, id: channel.id }
        socket.data.delta = { messages: new Map() }
        socket.data.practiceSignature = undefined
        socket.data.pageInfo = undefined
        socket.data.resume = typeof channel.cursor === 'string' && channel.cursor.length <= 4096 ? { cursor: channel.cursor, hasMore: Boolean(channel.hasMore) } : undefined
        await snapshot(socket)
        ack?.({ ok: true })
      } catch { ack?.({ ok: false }) }
    })
    socket.on('command', async (command, ack) => {
      if (typeof ack !== 'function') return
      try {
        const channel = socket.data.channel
        if (++count > 120 || !channel || !await authenticated(socket) || !await authorize(channel.kind, socket.request, channel.id)) throw new Error()
        const base = prefix(channel.kind, channel.id)
        if (typeof command?.path !== 'string' || !command.path.startsWith(`${base}/`) || command.path.includes('?') || command.path.includes('..')) throw new Error()
        const result = await dispatchChat(routers[channel.kind], socket.request, 'POST', command.path, command.body)
        ack?.(result)
        if (result.status < 400) publish(channel.kind, channel.id, result.data.message?.id ?? command.path.match(/\/messages\/([a-f\d]{24})\//)?.[1], command.path.includes('/practice') && !['ended', 'completed'].includes(result.data.practice?.status))
      } catch { ack?.({ status: 403, data: { error: 'This conversation is unavailable.' } }) }
    })
    socket.on('typing', async (typing) => {
      try {
        const channel = socket.data.channel
        if (++count > 120 || typeof typing !== 'boolean' || !channel || !await authenticated(socket) || !await authorize(channel.kind, socket.request, channel.id)) return
        const user = socket.request.accountUser
        const id = user._id.toString()
        const budget = typingBudgets.get(id)
        if (!budget || budget.until <= Date.now()) typingBudgets.set(id, { count: 1, until: Date.now() + 60000 })
        else if (++budget.count > 60) return
        for (const other of clients) {
          if (other === socket || other.request.accountUser?._id.toString() === user._id.toString() || other.data.channel?.kind !== channel.kind || other.data.channel?.id !== channel.id) continue
          if (!await authenticated(other) || !await authorize(channel.kind, other.request, channel.id)) continue
          other.emit('typing', { ...channel, typing, user: { id: user._id.toString(), username: user.username, avatarSeed: user.avatarSeed } })
        }
      } catch { /* Typing is ephemeral; the recipient expires it locally. */ }
    })
    socket.on('disconnect', () => { clearInterval(limiter); clients.delete(socket) })
  })
  return {
    publish,
    middleware(kind) {
      return (req, res, next) => {
        const json = res.json
        res.json = function(data) {
          const result = json.call(this, data)
          const match = req.path.match(kind === 'private' ? /^\/chats\/([a-f\d]{24})\// : /^\/([a-f\d]{24})\//)
          if (req.method === 'POST' && this.statusCode < 400 && match && !req.path.endsWith('/typing')) publish(kind, match[1], data.message?.id ?? req.path.match(/\/messages\/([a-f\d]{24})\//)?.[1], req.path.includes('/practice') && !['ended', 'completed'].includes(data.practice?.status))
          const messageId = req.path.match(/^\/messages\/([a-f\d]{24})\//)?.[1]
          if (kind === 'private' && req.method === 'POST' && this.statusCode < 400 && messageId) {
            void routers.private.chatMessageChannel(req, messageId).then((id) => { if (id) publish(kind, id, messageId) }).catch(() => {})
          }
          return result
        }
        next()
      }
    },
  }
}
