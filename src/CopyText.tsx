import { Copy } from 'lucide-react'
import type { ReactNode } from 'react'

export function CopyText({
  text,
  label,
  onCopy,
  as: Text = 'span',
  children,
}: {
  text: string
  label: string
  onCopy: (text: string) => void
  as?: 'span' | 'h2' | 'strong'
  children?: ReactNode
}) {
  return (
    <span className="copy-text">
      <Text lang="de">{children ?? text}</Text>
      <button type="button" className="copy-text-button" aria-label={`${label}: ${text}`} title={label} onClick={() => onCopy(text)}>
        <Copy size={16} aria-hidden="true" />
      </button>
    </span>
  )
}

