import { createHash } from 'node:crypto'

// Per-connection fingerprints bound network updates without retaining message text.
export function messageDelta(state, page) {
  const changed = []
  for (const message of page.messages) {
    const signature = createHash('sha256').update(JSON.stringify(message)).digest('hex')
    if (state.messages.get(message.id) !== signature) changed.push(message)
    state.messages.delete(message.id)
    state.messages.set(message.id, signature)
  }
  while (state.messages.size > 1000) state.messages.delete(state.messages.keys().next().value)
  const metadata = JSON.stringify([page.hasMore, page.group])
  const dirty = metadata !== state.metadata
  state.metadata = metadata
  return changed.length || dirty ? { ...page, messages: changed } : null
}
