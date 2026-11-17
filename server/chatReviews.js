import { z } from 'zod'

export const correctionTags = [
  'verb-position', 'verb-form', 'article', 'case', 'spelling',
  'word-choice', 'word-order', 'tense', 'punctuation', 'more-natural',
]
export const correctionSchema = z.object({
  text: z.string().trim().min(1).max(2000).optional(),
  note: z.string().trim().max(200).optional(),
  tags: z.array(z.enum(correctionTags)).max(3).optional(),
  approve: z.literal(true).optional(),
}).refine((value) => value.approve
  ? !value.text && !value.note && !value.tags?.length
  : Boolean(value.text))
export const correctionResponseSchema = z.object({ response: z.enum(['thanks', 'saved']) })
