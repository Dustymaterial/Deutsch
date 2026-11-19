export const selectGermanVoice = <T extends { lang: string; localService: boolean }>(voices: T[]) => {
  const german = voices.filter((voice) => /^de(?:-|$)/i.test(voice.lang))
  return german.find((voice) => voice.localService) ?? german[0]
}
