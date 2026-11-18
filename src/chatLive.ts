export function watchChatChanges(path: string, refresh: () => Promise<void> | void, onConnection?: (connected: boolean) => void) {
  const source = new EventSource(path)
  let closed = false
  let pending = false
  let running = false
  let fallback: ReturnType<typeof setInterval> | undefined
  const stopFallback = () => { clearInterval(fallback); fallback = undefined }
  const startFallback = () => {
    if (!closed && fallback === undefined) fallback = setInterval(invalidate, 5000)
  }
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
    stopFallback()
    onConnection?.(true)
    invalidate()
  }
  const onError = () => {
    startFallback()
    onConnection?.(false)
  }
  source.addEventListener('open', onOpen)
  source.addEventListener('change', invalidate)
  source.addEventListener('error', onError)
  startFallback()
  return () => { closed = true; stopFallback(); source.close() }
}
