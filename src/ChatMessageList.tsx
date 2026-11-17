import type { KeyboardEvent, MouseEvent, ReactNode } from 'react'

export function ChatMessageList({ updating, children }: { updating: boolean; children: ReactNode }) {
  const blockClick = (event: MouseEvent<HTMLFieldSetElement>) => {
    if (updating && event.target instanceof Element && event.target.closest('summary, a, [data-word]')) {
      event.preventDefault()
      event.stopPropagation()
    }
  }
  const blockKey = (event: KeyboardEvent<HTMLFieldSetElement>) => {
    if (updating && (event.key === 'Enter' || event.key === ' ')
      && event.target instanceof Element && event.target.closest('summary, a')) {
      event.preventDefault()
      event.stopPropagation()
    }
  }
  return <fieldset className="companion-chat-message-list" disabled={updating} onClickCapture={blockClick} onKeyDownCapture={blockKey}>{children}</fieldset>
}
