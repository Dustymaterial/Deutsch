import { z } from 'zod'

export const reactionEmojis = ['👍', '🎉', '💡', '❤️', '👏']
export const reactionSchema = z.object({ emoji: z.enum(reactionEmojis).nullable() })

export const summarizeReactions = (reactions, me) => reactionEmojis.flatMap((emoji) => {
  const users = Object.entries(reactions ?? {}).filter(([, value]) => value === emoji).map(([id]) => id)
  return users.length ? [{ emoji, count: users.length, mine: users.includes(me) }] : []
})
