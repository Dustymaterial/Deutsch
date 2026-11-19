import dictionaryUrl from './data/german-dictionary.json?url'
import { parseDictionary, type Dictionary } from './dictionaryLookup'

let loading: Promise<Dictionary> | null = null

// The dictionary is a separate file fetched on first use, so it never weighs on the app bundle.
export const loadDictionary = () => {
  loading ??= fetch(dictionaryUrl, { signal: AbortSignal.timeout(15_000) })
    .then(async (response) => {
      if (!response.ok) throw new Error('The dictionary could not be downloaded.')
      return parseDictionary(await response.json())
    })
    .catch((error: unknown) => {
      loading = null
      throw error
    })
  return loading
}
