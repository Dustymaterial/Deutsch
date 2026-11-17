import { useEffect, useState, type RefObject } from 'react'

export function useChatScrollState(stream: RefObject<HTMLDivElement | null>, key: string | null) {
  const [awayFromBottom, setAwayFromBottom] = useState(false)

  useEffect(() => {
    const element = stream.current
    if (!element || !key) return
    const update = () => {
      setAwayFromBottom(element.scrollHeight - element.scrollTop - element.clientHeight >= 160)
    }
    const observer = new ResizeObserver(update)
    observer.observe(element)
    if (element.firstElementChild) observer.observe(element.firstElementChild)
    element.addEventListener('scroll', update, { passive: true })
    return () => {
      observer.disconnect()
      element.removeEventListener('scroll', update)
    }
  }, [stream, key])

  return [awayFromBottom, setAwayFromBottom] as const
}
