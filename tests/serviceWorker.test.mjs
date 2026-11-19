import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8')
const page = (text, status = 200) => new Response(text, { status, headers: { 'content-type': 'text/html' } })
function worker({ network = page('fresh'), cached, failRead = false, failWrite = false } = {}) {
  const handlers = {}
  const stored = new Map(cached ? [['/', cached]] : [])
  const cache = {
    match: async (key) => { if (failRead) throw new Error('Cache unavailable'); return stored.get(typeof key === 'string' ? key : key.url)?.clone() },
    put: async (key, response) => { if (failWrite) throw new Error('Full'); stored.set(typeof key === 'string' ? key : key.url, response.clone()) },
  }
  vm.runInNewContext(source, {
    self: { location: { origin: 'https://deutsch.example' }, addEventListener: (type, action) => { handlers[type] = action } },
    caches: { open: async () => cache }, URL, Response,
    fetch: async () => { if (network instanceof Error) throw network; return network.clone() },
  })
  return { stored, dispatch: async (path = '/', mode = 'navigate', options = {}) => {
    let response
    const tasks = []
    handlers.fetch({ request: { url: `https://deutsch.example${path}`, method: 'GET', mode, cache: 'default', ...options },
      respondWith: (value) => { response = value }, waitUntil: (task) => tasks.push(task) })
    const result = await response
    await Promise.all(tasks)
    return result
  } }
}

test('cache-write failure keeps the successful page or asset response', async () => {
  for (const mode of ['navigate', 'cors']) {
    const { dispatch } = worker({ network: page('fresh'), cached: page('old'), failWrite: true })
    assert.equal(await (await dispatch('/new', mode)).text(), 'fresh')
  }
})
test('server errors and non-HTML responses cannot poison the offline page', async () => {
  for (const network of [page('server error', 500), page('missing', 404), new Response('{}', { headers: { 'content-type': 'application/json' } })]) {
    const { dispatch, stored } = worker({ network, cached: page('known good') })
    assert.equal(await (await dispatch()).text(), 'known good')
    assert.equal(await stored.get('/').text(), 'known good')
  }
  assert.equal((await worker({ network: page('error', 503) }).dispatch()).status, 503)
})
test('offline uses only a valid saved page, and cache-read failure still permits network', async () => {
  assert.equal(await (await worker({ network: new Error('offline'), cached: page('saved') }).dispatch()).text(), 'saved')
  assert.equal((await worker({ network: new Error('offline'), cached: page('broken', 500) }).dispatch()).type, 'error')
  assert.equal(await (await worker({ network: page('fresh'), failRead: true }).dispatch('/app.js', 'cors')).text(), 'fresh')
})
test('voice assets, API, socket transport and explicit no-store requests bypass shell caching', async () => {
  for (const path of ['/optional-voice/releases/v1/model', '/api/companions', '/socket.io/?transport=polling']) {
    assert.equal(await worker().dispatch(path, 'cors'), undefined)
  }
  assert.equal(await worker().dispatch('/other', 'cors', { cache: 'no-store' }), undefined)
})
