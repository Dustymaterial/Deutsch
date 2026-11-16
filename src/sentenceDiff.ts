export type DiffKind = 'same' | 'added' | 'removed'
export type DiffPart = { text: string; kind: DiffKind; spaceBefore: boolean }

type Token = { text: string; spaceBefore: boolean }

const tokenPattern = /[\p{L}\p{M}\p{N}]+(?:['’-][\p{L}\p{M}\p{N}]+)*|[^\s\p{L}\p{M}\p{N}]/gu

const tokenize = (text: string): Token[] => {
  const tokens: Token[] = []
  let previousEnd = 0
  for (const match of text.matchAll(tokenPattern)) {
    const start = match.index ?? 0
    tokens.push({ text: match[0], spaceBefore: tokens.length > 0 && start > previousEnd })
    previousEnd = start + match[0].length
  }
  return tokens
}

// Word-level diff of a sentence and its suggested rewrite, so only the changed words stand out.
export const diffSentences = (original: string, corrected: string): DiffPart[] => {
  const before = tokenize(original)
  const after = tokenize(corrected)
  const lengths = Array.from({ length: before.length + 1 }, () => new Array<number>(after.length + 1).fill(0))
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      lengths[i][j] = before[i].text === after[j].text
        ? lengths[i + 1][j + 1] + 1
        : Math.max(lengths[i + 1][j], lengths[i][j + 1])
    }
  }

  const parts: DiffPart[] = []
  let i = 0
  let j = 0
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i].text === after[j].text) {
      parts.push({ text: after[j].text, kind: 'same', spaceBefore: after[j].spaceBefore })
      i += 1
      j += 1
    } else if (i < before.length && (j >= after.length || lengths[i + 1][j] >= lengths[i][j + 1])) {
      parts.push({ text: before[i].text, kind: 'removed', spaceBefore: before[i].spaceBefore })
      i += 1
    } else {
      parts.push({ text: after[j].text, kind: 'added', spaceBefore: after[j].spaceBefore })
      j += 1
    }
  }
  if (parts.length) parts[0] = { ...parts[0], spaceBefore: false }
  return parts
}
