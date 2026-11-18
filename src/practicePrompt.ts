export function practicePrompt(prompt: string, article?: string | null) {
  if (!article || prompt.trimStart().toLocaleLowerCase('de-DE').startsWith(`${article.toLocaleLowerCase('de-DE')} `)) return prompt
  return `${article} ${prompt}`
}
