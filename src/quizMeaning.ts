export const meaningKeys = (meaning: string) => new Set(meaning.normalize('NFC').toLocaleLowerCase('en')
  .split(/[;,/]/).map((part) => part.replace(/\([^)]*\)/g, '').trim().replace(/^(?:to|a|an|the)\s+/, '').trim()).filter(Boolean))

export const meaningsOverlap = (left: string, right: string) => {
  const rightKeys = meaningKeys(right)
  return [...meaningKeys(left)].some((key) => rightKeys.has(key))
}
