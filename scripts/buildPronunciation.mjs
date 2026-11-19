import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { downloadKaikki } from './kaikkiDownload.mjs'

const pack = JSON.parse(await readFile('src/data/german-starter-pack.json','utf8'))
const key = value => value.normalize('NFC').trim().toLocaleLowerCase('de-DE')
const strip = value => value.replace(/^(der|die|das)\s+/i,'')
const wanted = new Set(pack.cards.flatMap(card=>[key(card.word),...(card.plural?[key(strip(card.plural))]:[])]))
const cache = join(tmpdir(),'deutsch-audio-metadata')
await mkdir(cache,{recursive:true})
const candidates = new Map()
const alternatives = new Map()
const attributionChecks = JSON.parse(await readFile('src/data/pronunciation-attributions.json','utf8'))
const verifiedAuthors = attributionChecks.authors
const {path,lastModified} = await downloadKaikki()
for await (const line of createInterface({input:createReadStream(path),crlfDelay:Infinity})) {
  const e=JSON.parse(line)
  if(!wanted.has(key(e.word??'')))continue
  const sounds=(e.sounds??[]).filter(s=>s.audio && /^https:\/\/upload.wikimedia.org\//.test(s.mp3_url??s.ogg_url??''))
  if(!sounds.length)continue
  alternatives.set(key(e.word), [...(alternatives.get(key(e.word))??[]), ...sounds])
  const current=candidates.get(key(e.word))
  const ranked = sounds.sort((a,b) => Number(/De-(?:at|ch)-/i.test(a.audio)) - Number(/De-(?:at|ch)-/i.test(b.audio)))
  if(!current || (/De-(?:at|ch)-/i.test(current.audio) && !/De-(?:at|ch)-/i.test(ranked[0].audio)))candidates.set(key(e.word),ranked[0])
}
for (const item of attributionChecks.additionalFiles ?? []) candidates.set(key(item.word), { audio: item.file })
const titles=[...new Set([...candidates.values()].map(s=>'File:'+s.audio))]
console.log(`${candidates.size} word forms with source audio; checking ${titles.length} Commons files`)
const metadata=new Map()
for(let index=0;index<titles.length;index+=40){
  const batch=titles.slice(index,index+40)
  const file=join(cache,`${createHash('sha256').update(batch.join('|')).digest('hex')}-${index}.json`)
  let result=await readFile(file,'utf8').then(JSON.parse).catch(()=>null)
  if(!result){
    const url=new URL('https://commons.wikimedia.org/w/api.php')
    url.search=new URLSearchParams({action:'query',format:'json',prop:'imageinfo',iiprop:'url|mime|extmetadata',titles:batch.join('|')}).toString()
    const response=await fetch(url,{headers:{'User-Agent':'DeutschDeckDataBuilder/1.0 (https://github.com/saintheraldfaust/Deutsch)'},signal:AbortSignal.timeout(30000)})
    if(!response.ok)throw new Error(`Commons HTTP ${response.status}`)
    result=await response.json()
    if(result.error)throw new Error(JSON.stringify(result.error))
    await writeFile(file,JSON.stringify(result))
  }
  const pages=Object.values(result.query?.pages??{})
  const normal=new Map((result.query?.normalized??[]).map(n=>[n.from,n.to]))
  for(const title of batch){const page=pages.find(p=>p.title===(normal.get(title)??title)); if(page?.imageinfo?.[0])metadata.set(title,page.imageinfo[0])}
  console.log(`Checked ${Math.min(index+40,titles.length)}/${titles.length}`)
}
const clean=value=>value.replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"').trim()
const entries={}
const verifiedRecording = (sound) => {
  const info=metadata.get('File:'+sound.audio), meta=info?.extmetadata
  const license=meta?.LicenseShortName?.value??''
  const licenseUrl=meta?.LicenseUrl?.value??(license==='Public domain'?'https://creativecommons.org/publicdomain/mark/1.0/':'')
  const author=verifiedAuthors['File:'+sound.audio]??clean(meta?.Artist?.value??'')
  if(!(/^(?:audio\/|application\/ogg$)/.test(info?.mime??'')) || !author || !/^(CC BY(?:-SA)? [234]\.[05](?: [a-z-]+)?|CC0|Public domain)$/i.test(license))return null
  if(!/^https?:\/\/(?:www\.)?creativecommons.org\//.test(licenseUrl))return null
  const original = info.url.split('?')[0]
  const mp3 = original.replace('/commons/', '/commons/transcoded/') + '/' + original.split('/').at(-1) + '.mp3'
  return {url:sound.mp3_url??sound.ogg_url??mp3,source:info.descriptionurl,author,license,licenseUrl:licenseUrl.replace(/^http:/,'https:'),modified:false}
}
for(const [word,sound] of candidates){ const recording=verifiedRecording(sound); if(recording)entries[word]=recording }
// Try source-listed alternative recordings when the preferred file lacks usable
// attribution or has a non-free license. Never use an uploader as the creator.
const pending = [...alternatives].filter(([word])=>!entries[word])
const extraTitles=[...new Set(pending.flatMap(([,sounds])=>sounds.map(s=>'File:'+s.audio)))].filter(title=>!metadata.has(title))
for(let index=0;index<extraTitles.length;index+=40){
  const url=new URL('https://commons.wikimedia.org/w/api.php')
  url.search=new URLSearchParams({action:'query',format:'json',prop:'imageinfo',iiprop:'url|mime|extmetadata',titles:extraTitles.slice(index,index+40).join('|')})
  const response=await fetch(url,{signal:AbortSignal.timeout(30000)})
  if(!response.ok)throw new Error(`Commons HTTP ${response.status}`)
  const data=await response.json()
  for(const page of Object.values(data.query?.pages??{}))if(page.imageinfo?.[0])metadata.set(page.title,page.imageinfo[0])
}
for(const [word,sounds] of pending){for(const sound of sounds){const recording=verifiedRecording(sound);if(recording){entries[word]=recording;break}}}
const covered=pack.cards.filter(c=>Object.hasOwn(entries,key(c.word))).length
const output={format:'deutsch-pronunciation',version:1,source:'German Wiktionary entries via Kaikki.org; file metadata verified with Wikimedia Commons',sourceDate:lastModified,checkedAt:new Date().toISOString().slice(0,10),license:'Per-recording licenses and attribution in entries; source metadata adapted under CC BY-SA 4.0',entries,coverage:{starterCards:pack.cards.length,coveredCards:covered,missingWords:[...new Set(pack.cards.filter(c=>!Object.hasOwn(entries,key(c.word))).map(c=>c.word))]}}
await writeFile('src/data/german-pronunciation.json',JSON.stringify(output)+'\n')
console.log(`Human audio: ${covered}/${pack.cards.length} starter cards, ${Object.keys(entries).length} forms`)
