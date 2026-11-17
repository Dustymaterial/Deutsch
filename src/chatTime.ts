const formatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export function formatChatTime(value: string) {
  return formatter.format(new Date(value))
}
