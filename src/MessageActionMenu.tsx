import { useEffect, useId, useRef, useState } from 'react'
import { Ellipsis } from 'lucide-react'
import { FloatingPopover } from './FloatingPopover'

export type MessageAction = {
  label: string
  danger?: boolean
  disabled?: boolean
  onSelect: (anchor: HTMLButtonElement) => void
}

export function MessageActionMenu({ label, actions }: { label: string; actions: MessageAction[] }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const focus = requestAnimationFrame(() => panel.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus())
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !trigger.current?.contains(event.target) && !panel.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => { cancelAnimationFrame(focus); document.removeEventListener('pointerdown', closeOutside) }
  }, [open])

  return <span className="companion-message-menu">
    <button ref={trigger} className="companion-message-menu-trigger" type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen((current) => !current)}><Ellipsis size={15} aria-hidden="true" /></button>
    {open && <FloatingPopover anchorRef={trigger} popoverRef={panel} owner={id} id={id} preferredWidth={180} className="companion-row-popover companion-message-popover" role="menu" aria-label={label} onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus() }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        const options = [...(panel.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
        if (!options.length) return
        const index = options.findIndex((option) => option === document.activeElement)
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
          : event.key === 'ArrowDown' ? (index + 1) % options.length : (index - 1 + options.length) % options.length
        event.preventDefault()
        options[next].focus()
      }
    }}>
      {actions.map((action) => <button key={action.label} type="button" role="menuitem" className={action.danger ? 'danger' : undefined} disabled={action.disabled} onClick={() => {
        const anchor = trigger.current
        setOpen(false)
        if (anchor) action.onSelect(anchor)
      }}>{action.label}</button>)}
    </FloatingPopover>}
  </span>
}
