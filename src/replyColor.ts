import type { CSSProperties } from 'react'

const replyPalette = [
  { accent: '#8fb9e6', tint: '#e8f1fb' },
  { accent: '#f0a3cf', tint: '#fbe9f3' },
  { accent: '#9fd49a', tint: '#e9f5e6' },
  { accent: '#efc36a', tint: '#fbf1d9' },
  { accent: '#b9a5e8', tint: '#f0ebfb' },
  { accent: '#84d0c8', tint: '#e3f5f3' },
]

// Message ids end in an increasing counter, so neighbouring messages get different colours.
export const replyColor = (messageId: string) => {
  const color = replyPalette[(Number.parseInt(messageId.slice(-6), 16) || 0) % replyPalette.length]
  return { '--reply-accent': color.accent, '--reply-tint': color.tint } as CSSProperties
}
