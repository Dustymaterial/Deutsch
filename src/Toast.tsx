import { useEffect } from 'react'

export type ToastMessage = {
  id: number
  message: string
  kind: 'success' | 'error'
}

export function Toast({ toast, onDismiss }: { toast: ToastMessage; onDismiss: (id: number) => void }) {
  useEffect(() => {
    if (toast.kind === 'error') return
    const timer = window.setTimeout(() => onDismiss(toast.id), 4000)
    return () => window.clearTimeout(timer)
  }, [toast, onDismiss])

  return (
    <div className={`toast toast-${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'}>
      <span>{toast.message}</span>
      {toast.kind === 'error' && <button type="button" onClick={() => onDismiss(toast.id)}>Dismiss</button>}
    </div>
  )
}
