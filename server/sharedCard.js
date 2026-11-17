import { z } from 'zod'

export const sharedCardSchema = z.object({
  prompt: z.string().trim().min(1).max(500),
  article: z.enum(['der', 'die', 'das']).optional(),
  meaning: z.string().trim().min(1).max(1000),
  plural: z.string().max(500).optional(),
  example: z.string().trim().min(1).max(2000),
  translation: z.string().max(2000).optional(),
  category: z.enum(['noun', 'verb', 'adjective', 'adverb', 'numeral', 'phrase']),
}).refine((card) => card.category !== 'noun' || Boolean(card.article), { message: 'Nouns require an article.' })
