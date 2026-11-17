export function watchChatChanges(path: string, refresh: () => Promise<void> | void) {
  const source = new EventSource(path)
  let warned = false
  let closed = false
  let pending = false
  let running = false
  const invalidate = () => {
    pending = true
    if (running) return
    running = true
    void (async () => {
      try {
        while (pending && !closed) {
          pending = false
          await refresh()
        }
      } catch (error) {
        console.error('Could not refresh a live chat.', error)
      } finally {
        running = false
      }
    })()
  }
  const onOpen = () => {
    warned = false
    invalidate()
  }
  const onError = () => {
    if (!warned) {
      console.warn('Live chat is disconnected; periodic refresh remains active.')
      warned = true
    }
  }
  source.addEventListener('open', onOpen)
  source.addEventListener('change', invalidate)
  source.addEventListener('error', onError)
  return () => { closed = true; source.close() }
}
