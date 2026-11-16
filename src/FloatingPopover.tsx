import { useLayoutEffect, useState, type HTMLAttributes, type RefObject } from 'react'
import { createPortal } from 'react-dom'

export function FloatingPopover({
  anchorRef,
  popoverRef,
  owner,
  preferredWidth,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  anchorRef: RefObject<HTMLButtonElement | null>
  popoverRef: RefObject<HTMLDivElement | null>
  owner: string
  preferredWidth?: number
}) {
  const [position, setPosition] = useState<React.CSSProperties>({ visibility: 'hidden' })

  useLayoutEffect(() => {
    const updatePosition = () => {
      const anchor = anchorRef.current
      const popover = popoverRef.current
      if (!anchor || !popover) return
      const rect = anchor.getBoundingClientRect()
      const width = Math.min(Math.max(preferredWidth ?? rect.width, 150), window.innerWidth - 32)
      const below = window.innerHeight - rect.bottom - 16
      const above = rect.top - 16
      const desiredHeight = popover.scrollHeight
      const placeAbove = below < Math.min(desiredHeight, 240) && above > below
      const maxHeight = Math.max(0, Math.min(320, placeAbove ? above : below))
      const height = Math.min(desiredHeight, maxHeight)
      setPosition({
        position: 'fixed',
        zIndex: 30,
        top: placeAbove ? rect.top - height - 6 : rect.bottom + 6,
        left: Math.max(16, Math.min(rect.left, window.innerWidth - width - 16)),
        width,
        maxHeight,
        overflowY: 'auto',
      })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [anchorRef, popoverRef, preferredWidth, children])

  return createPortal(
    <div {...props} ref={popoverRef} data-panel-owner={owner} style={position}>
      {children}
    </div>,
    document.body,
  )
}
