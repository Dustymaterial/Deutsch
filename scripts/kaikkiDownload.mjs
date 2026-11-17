import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export const KAIKKI_URL = 'https://kaikki.org/dictionary/German/kaikki.org-dictionary-German.jsonl'

// Downloads the German Wiktionary extract (about 1.1 GB uncompressed, about 100 MB on the wire) and
// reuses the cached copy while the server's size and Last-Modified date are unchanged.
export const downloadKaikki = async (directory = process.env.DICTIONARY_KAIKKI_DIR ?? join(tmpdir(), 'deutsch-kaikki')) => {
  await mkdir(directory, { recursive: true })
  const head = await fetch(KAIKKI_URL, { method: 'HEAD', headers: { 'Accept-Encoding': 'identity' } })
  if (!head.ok) throw new Error(`Could not reach ${KAIKKI_URL}: HTTP ${head.status}`)
  const size = Number(head.headers.get('content-length'))
  const lastModified = head.headers.get('last-modified') ?? 'unknown'
  const path = join(directory, `german-${size}-${lastModified.replace(/[^0-9A-Za-z]+/g, '-')}.jsonl`)
  const existing = await stat(path).catch(() => null)
  if (existing?.size === size) return { path, size, lastModified }

  console.log(`Downloading ${(size / 1e6).toFixed(0)} MB (uncompressed) from kaikki.org…`)
  const response = await fetch(KAIKKI_URL, { headers: { 'Accept-Encoding': 'gzip' } })
  if (!response.ok || !response.body) throw new Error(`Could not download ${KAIKKI_URL}: HTTP ${response.status}`)
  const partial = `${path}.part`
  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(partial))
    const written = await stat(partial)
    if (written.size !== size) throw new Error(`Incomplete download: ${written.size} of ${size} bytes`)
    await rename(partial, path)
  } catch (error) {
    await rm(partial, { force: true })
    throw error
  }
  return { path, size, lastModified }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await downloadKaikki()
  console.log(`Ready: ${result.path}`)
}
