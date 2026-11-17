export type MessageLinkPart = { text: string; href?: string }

export function splitMessageLinks(text: string): MessageLinkPart[] {
  const parts: MessageLinkPart[] = []
  const pattern = /(?:https?:\/\/|www\.)[^\s<>"']+/gi
  let end = 0
  for (const match of text.matchAll(pattern)) {
    const start = match.index
    if (start > end) parts.push({ text: text.slice(end, start) })
    let value = match[0]
    while (/[.,!?;:]$/.test(value) || (value.endsWith(')') && (value.match(/\)/g)?.length ?? 0) > (value.match(/\(/g)?.length ?? 0))
      || (value.endsWith(']') && (value.match(/\]/g)?.length ?? 0) > (value.match(/\[/g)?.length ?? 0))) {
      value = value.slice(0, -1)
    }
    const href = /^www\./i.test(value) ? `https://${value}` : value
    try {
      const url = new URL(href)
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error('Invalid link')
      parts.push({ text: value, href: url.href })
    } catch {
      parts.push({ text: value })
    }
    end = start + value.length
  }
  if (end < text.length) parts.push({ text: text.slice(end) })
  return parts
}
