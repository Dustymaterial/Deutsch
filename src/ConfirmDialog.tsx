import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { ConfirmContext, type Confirm, type ConfirmOptions } from './confirmContext'

type Pending = { options: ConfirmOptions; resolve: (confirmed: boolean) => void }

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const messageId = useId()

  const confirm = useCallback<Confirm>((options) => new Promise((resolve) => {
    setPending((current) => {
      current?.resolve(false)
      return { options, resolve }
    })
  }), [])

  useEffect(() => {
    if (pending && dialog.current && !dialog.current.open) dialog.current.showModal()
  }, [pending])

  const settle = (confirmed: boolean) => {
    dialog.current?.close()
    pending?.resolve(confirmed)
    setPending(null)
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <dialog
          ref={dialog}
          className="confirm-dialog"
          aria-labelledby={titleId}
          aria-describedby={messageId}
          onCancel={(event) => { event.preventDefault(); settle(false) }}
          onClick={(event) => { if (event.target === event.currentTarget) settle(false) }}
          // Keep the panels underneath from treating dialog interaction as an outside click or Escape.
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <div className="confirm-dialog-body">
            <h2 id={titleId}>{pending.options.title}</h2>
            <p id={messageId}>{pending.options.message}</p>
            <div className="confirm-dialog-actions">
              <button type="button" className="confirm-cancel" onClick={() => settle(false)}>
                {pending.options.cancelLabel ?? 'Cancel'}
              </button>
              <button type="button" className={`confirm-accept ${pending.options.tone ?? 'neutral'}`} onClick={() => settle(true)}>
                {pending.options.confirmLabel}
              </button>
            </div>
          </div>
        </dialog>
      )}
    </ConfirmContext.Provider>
  )
}
