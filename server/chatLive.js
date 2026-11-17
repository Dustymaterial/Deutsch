const collections = ['companionMessages', 'groupMessages', 'chatTyping', 'groups', 'groupMembers']

function destination(change) {
  const document = change.fullDocument
  switch (change.ns?.coll) {
    case 'companionMessages':
      return document?.conversationId && ['private', document.conversationId]
    case 'groupMessages':
      return document?.groupId && ['group', document.groupId]
    case 'groupMembers':
      if (change.operationType === 'update' && !('state' in (change.updateDescription?.updatedFields ?? {}))) return null
      return document?.groupId && ['group', document.groupId]
    case 'groups':
      if (change.operationType === 'update'
        && Object.keys(change.updateDescription?.updatedFields ?? {}).every((field) => field === 'lastActivityAt')) return null
      return change.documentKey?._id && ['group', change.documentKey._id.toString()]
    case 'chatTyping':
      return document?.chatId && ['private', 'group'].includes(document.kind) && [document.kind, document.chatId]
    default:
      return null
  }
}

export function createChatLiveHub(db) {
  const subscribers = new Map()
  let available = false

  function closeAll() {
    available = false
    for (const listeners of subscribers.values()) {
      for (const listener of listeners) listener.close()
    }
  }

  function start() {
    try {
      const stream = db.watch([{ $match: { 'ns.coll': { $in: collections } } }], { fullDocument: 'updateLookup' })
      available = true
      let failed = false
      const fail = (error) => {
        if (failed) return
        failed = true
        console.error('Chat live delivery is unavailable:', error.message)
        closeAll()
        void stream.close().catch((failure) => console.error('Could not close the chat change stream:', failure.message))
        setTimeout(start, 15000).unref()
      }
      stream.on('change', (change) => {
        if (failed) return
        const target = destination(change)
        if (!target) return
        const listeners = subscribers.get(`${target[0]}:${target[1]}`)
        if (listeners) for (const listener of listeners) listener.notify()
      })
      stream.on('error', fail)
      stream.on('end', () => fail(new Error('Change stream ended unexpectedly.')))
    } catch (error) {
      console.error('Chat live delivery could not start:', error.message)
      closeAll()
      setTimeout(start, 15000).unref()
    }
  }
  start()

  return {
    subscribe(req, res, kind, id, authorize) {
      if (!available) return res.status(503).json({ error: 'Live chat is unavailable; periodic refresh remains active.' })
      const key = `${kind}:${id}`
      const listeners = subscribers.get(key) ?? new Set()
      subscribers.set(key, listeners)
      let closed = false
      let pending = false
      let checking = false
      let blocked = false
      const close = () => {
        if (closed) return
        closed = true
        clearInterval(heartbeat)
        listeners.delete(listener)
        if (!listeners.size) subscribers.delete(key)
        res.end()
      }
      const flush = async () => {
        if (closed || checking || blocked || !pending) return
        checking = true
        pending = false
        try {
          if (!await authorize()) {
            close()
            return
          }
          if (!closed) blocked = !res.write('event: change\ndata: {}\n\n')
        } catch (error) {
          console.error('Chat live authorization failed:', error.message)
          close()
        } finally {
          checking = false
          if (pending && !blocked) void flush()
        }
      }
      const listener = { close, notify: () => { pending = true; void flush() } }
      const heartbeat = setInterval(() => {
        if (!blocked && !closed) blocked = !res.write(': heartbeat\n\n')
      }, 25000)
      res.on('drain', () => { blocked = false; void flush() })
      req.on('close', close)
      listeners.add(listener)
      res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no' })
      res.flushHeaders()
      blocked = !res.write('retry: 15000\n\n')
      return undefined
    },
  }
}

export function liveSessionValid(req, users) {
  return new Promise((resolve, reject) => {
    req.sessionStore.get(req.sessionID, async (error, session) => {
      if (error) { reject(error); return }
      try {
        const id = req.accountUser._id
        if (!session || session.userId !== id.toString()
          || (session.cookie?.expires && new Date(session.cookie.expires) <= new Date())) {
          resolve(false)
          return
        }
        const user = await users.findOne({ _id: id }, { projection: { sessionVersion: 1, emailVerifiedAt: 1 } })
        resolve(Boolean(user?.emailVerifiedAt && (user.sessionVersion ?? 0) === (session.sessionVersion ?? 0)))
      } catch (failure) {
        reject(failure)
      }
    })
  })
}
