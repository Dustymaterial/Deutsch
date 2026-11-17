import { useEffect, useId, useRef, useState, type RefObject } from 'react'
import { FloatingPopover } from './FloatingPopover'
import { MenuSelect } from './MenuSelect'

export type ReportReason = 'spam' | 'harassment' | 'inappropriate' | 'other'
const reasons: { value: ReportReason; label: string }[] = [
  { value: 'spam', label: 'Spam' },
  { value: 'harassment', label: 'Harassment' },
  { value: 'inappropriate', label: 'Inappropriate content' },
  { value: 'other', label: 'Other' },
]

export function ReportPopover({ anchorRef, title, onClose, onSubmit }: {
  anchorRef: RefObject<HTMLButtonElement | null>
  title: string
  onClose: () => void
  onSubmit: (reason: ReportReason, details: string) => Promise<void>
}) {
  const id = useId()
  const panel = useRef<HTMLDivElement>(null)
  const [reason, setReason] = useState<ReportReason>('other')
  const [details, setDetails] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const focus = requestAnimationFrame(() => panel.current?.focus())
    const closeOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || panel.current?.contains(event.target)) return
      const owner = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-panel-owner]')?.dataset.panelOwner : undefined
      if (owner && [...(panel.current?.querySelectorAll('[aria-controls]') ?? [])].some((element) => element.getAttribute('aria-controls') === owner)) return
      onClose()
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => { cancelAnimationFrame(focus); document.removeEventListener('pointerdown', closeOutside) }
  }, [anchorRef, onClose])

  return <FloatingPopover anchorRef={anchorRef} popoverRef={panel} owner={id} id={id} preferredWidth={320} preferredMaxHeight={640} className="chat-report-popover" role="dialog" aria-label={title} tabIndex={-1} onKeyDown={(event) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); anchorRef.current?.focus() }
  }}>
    <form className="chat-report-form" onSubmit={(event) => {
      event.preventDefault()
      setBusy(true)
      setError(null)
      void onSubmit(reason, details.trim()).then(() => {
        onClose()
        anchorRef.current?.focus()
      }).catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'Could not submit the report.'))
        .finally(() => setBusy(false))
    }}>
      <div className="group-popover-heading"><strong>{title}</strong></div>
      <div className="companion-field">Report reason
        <MenuSelect ariaLabel="Report reason" options={reasons} value={reason} onChange={setReason} />
      </div>
      <label className="companion-field">Additional details (optional)
        <textarea maxLength={500} rows={2} value={details} onChange={(event) => setDetails(event.target.value)} />
      </label>
      {error && <p className="companion-alert" role="alert">{error}</p>}
      <div className="companion-card-actions">
        <button type="submit" disabled={busy}>Submit report</button>
        <button type="button" disabled={busy} onClick={() => { onClose(); anchorRef.current?.focus() }}>Cancel</button>
      </div>
    </form>
  </FloatingPopover>
}
