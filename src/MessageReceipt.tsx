import { Check, CheckCheck, Clock3 } from 'lucide-react'

export type MessageReceiptStatus = 'sending' | 'sent' | 'delivered' | 'read'

export function MessageReceipt({ status }: { status: MessageReceiptStatus }) {
  const label = { sending: 'Sending', sent: 'Sent', delivered: 'Delivered', read: 'Read' }[status]
  const Icon = status === 'sending' ? Clock3 : status === 'sent' ? Check : CheckCheck
  return <span className={`companion-send-status ${status}`} role="img" aria-label={label} title={label}>
    <Icon size={13} aria-hidden="true" />
  </span>
}
