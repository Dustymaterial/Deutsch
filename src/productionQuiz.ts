const normalizeAnswer = (value: string) =>
  value
    .normalize('NFC')
    .trim()
    .toLocaleLowerCase('de-DE')
    .replace(/\s+/g, ' ')
    .replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, '')

export const isProductionAnswerCorrect = (answer: string, expected: string) =>
  normalizeAnswer(answer) === normalizeAnswer(expected)
